import db from "./db.server";

const NAMESPACE = "store_selector";
const KEY = "data";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

// Ensures the shop metafield definition exists with storefront read access so
// the theme can read it via {{ shop.metafields.store_selector.data }}.
async function ensureDefinition(admin: AdminGraphql) {
  const response = await admin(
    `#graphql
      mutation CreateDef($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        definition: {
          name: "Store Selector data",
          namespace: NAMESPACE,
          key: KEY,
          type: "json",
          ownerType: "SHOP",
          access: { storefront: "PUBLIC_READ" },
        },
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
  // "TAKEN" simply means the definition already exists — safe to ignore.
  const fatal = errors.filter((e: any) => e.code !== "TAKEN");
  if (fatal.length) {
    throw new Error(
      "Failed to create metafield definition: " + JSON.stringify(fatal),
    );
  }
}

async function getShopId(admin: AdminGraphql): Promise<string> {
  const response = await admin(`#graphql
    query { shop { id } }`);
  const json = await response.json();
  return json.data.shop.id;
}

// Collects the numeric product ids that have available inventory (> 0) at the
// given location, paginating through inventory levels.
async function productIdsAtLocation(
  admin: AdminGraphql,
  locationId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  const MAX_PAGES = 50;

  do {
    const response: Response = await admin(
      `#graphql
        query LocationInventory($id: ID!, $cursor: String) {
          location(id: $id) {
            inventoryLevels(first: 250, after: $cursor) {
              nodes {
                quantities(names: ["available"]) { name quantity }
                item { variant { product { id } } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { variables: { id: locationId, cursor } },
    );
    const body: any = await response.json();
    const levels = body.data?.location?.inventoryLevels;
    if (!levels) break;

    for (const node of levels.nodes ?? []) {
      const available =
        node.quantities?.find((q: any) => q.name === "available")?.quantity ??
        0;
      const gid = node.item?.variant?.product?.id;
      if (available > 0 && gid) {
        const numeric = String(gid).split("/").pop();
        if (numeric) ids.add(numeric);
      }
    }

    cursor = levels.pageInfo?.hasNextPage ? levels.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return Array.from(ids);
}

// Computes the storefront payload and writes it to the shop metafield.
// Returns a small summary for display in the admin UI.
export async function syncStorefrontData(admin: AdminGraphql, shop: string) {
  // All active Shopify locations with their display details.
  const locResponse = await admin(`#graphql
    query {
      locations(first: 50, includeInactive: false) {
        nodes { id name address { formatted } }
      }
    }`);
  const locJson = await locResponse.json();
  const allLocations = locJson.data?.locations?.nodes ?? [];

  // Merchant's per-location show/hide preference (default shown).
  const settings = await db.locationSetting.findMany({ where: { shop } });
  const enabledMap = new Map(settings.map((s) => [s.locationId, s.enabled]));
  const enabled = allLocations.filter(
    (l: any) => enabledMap.get(l.id) ?? true,
  );

  const availability: Record<string, string[]> = {};
  for (const loc of enabled) {
    availability[loc.id] = await productIdsAtLocation(admin, loc.id);
  }

  const appSetting = await db.appSetting.findUnique({ where: { shop } });

  const payload = {
    locations: enabled.map((l: any) => ({
      id: l.id,
      name: l.name,
      address: (l.address?.formatted ?? []).join(", ") || null,
    })),
    availability,
    settings: {
      showFloatingButton: appSetting?.showFloatingButton ?? false,
    },
    updatedAt: new Date().toISOString(),
  };

  await ensureDefinition(admin);
  const shopId = await getShopId(admin);

  const setResponse = await admin(
    `#graphql
      mutation SetData($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: NAMESPACE,
            key: KEY,
            type: "json",
            value: JSON.stringify(payload),
          },
        ],
      },
    },
  );
  const setJson = await setResponse.json();
  const errors = setJson.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error("Failed to write metafield: " + JSON.stringify(errors));
  }

  return {
    locationCount: payload.locations.length,
    productCounts: Object.fromEntries(
      payload.locations.map((l: any) => [
        l.name,
        availability[l.id]?.length ?? 0,
      ]),
    ),
  };
}

// Serverless-safe throttle: bursts of inventory webhooks (one per
// variant/location) would otherwise trigger a sync per event. We record the
// last sync time per shop in the DB and skip if one ran recently. Because the
// sync always reads the *current* full inventory state, occasional runs still
// converge to the correct result. The manual "Sync" button is the fallback for
// any change that lands inside a throttle window.
const THROTTLE_MS = 20_000;

export async function maybeSyncThrottled(admin: AdminGraphql, shop: string) {
  const state = await db.syncState.findUnique({ where: { shop } });
  const now = Date.now();

  if (state && now - state.lastSyncedAt.getTime() < THROTTLE_MS) {
    return { skipped: true };
  }

  await db.syncState.upsert({
    where: { shop },
    create: { shop, lastSyncedAt: new Date(now) },
    update: { lastSyncedAt: new Date(now) },
  });

  await syncStorefrontData(admin, shop);
  return { skipped: false };
}
