import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Button,
  IndexTable,
  Text,
  Badge,
  Banner,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncStorefrontData } from "../sync.server";

type ShopifyLocation = {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query AppLocations {
        locations(first: 50, includeInactive: false) {
          nodes {
            id
            name
            isActive
            address {
              formatted
            }
          }
        }
      }`,
  );
  const json = await response.json();

  const locations: ShopifyLocation[] = (json.data?.locations?.nodes ?? []).map(
    (n: any) => ({
      id: n.id,
      name: n.name,
      isActive: n.isActive,
      address: (n.address?.formatted ?? []).join(", ") || null,
    }),
  );

  const settings = await db.locationSetting.findMany({
    where: { shop: session.shop },
  });
  const enabledMap = new Map(settings.map((s) => [s.locationId, s.enabled]));

  const appSetting = await db.appSetting.findUnique({
    where: { shop: session.shop },
  });

  return {
    locations: locations.map((l) => ({
      ...l,
      // Default to enabled when no preference has been saved yet.
      enabled: enabledMap.get(l.id) ?? true,
    })),
    showFloatingButton: appSetting?.showFloatingButton ?? false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    try {
      const summary = await syncStorefrontData(admin.graphql, session.shop);
      return { ok: true, synced: true, summary };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  if (intent === "toggleFloating") {
    const show = String(formData.get("show")) === "true";
    await db.appSetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, showFloatingButton: show },
      update: { showFloatingButton: show },
    });
    try {
      await syncStorefrontData(admin.graphql, session.shop);
    } catch (e) {
      return { ok: true, syncWarning: (e as Error).message };
    }
    return { ok: true };
  }

  // Toggle a location's visibility, then re-sync so the storefront reflects it.
  const locationId = String(formData.get("locationId"));
  const enabled = String(formData.get("enabled")) === "true";

  await db.locationSetting.upsert({
    where: { shop_locationId: { shop: session.shop, locationId } },
    create: { shop: session.shop, locationId, enabled },
    update: { enabled },
  });

  try {
    await syncStorefrontData(admin.graphql, session.shop);
  } catch (e) {
    return { ok: true, syncWarning: (e as Error).message };
  }

  return { ok: true };
};

export default function Locations() {
  const { locations, showFloatingButton } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const toggle = (locationId: string, current: boolean) => {
    fetcher.submit(
      { locationId, enabled: String(!current) },
      { method: "POST" },
    );
  };

  const toggleFloating = (next: boolean) => {
    fetcher.submit(
      { intent: "toggleFloating", show: String(next) },
      { method: "POST" },
    );
  };

  const rowMarkup = locations.map((location, index) => (
    <IndexTable.Row id={location.id} key={location.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {location.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{location.address || "—"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={location.enabled ? "success" : undefined}>
          {location.enabled ? "Shown in popup" : "Hidden"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <button
          type="button"
          onClick={() => toggle(location.id, location.enabled)}
          style={{
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "4px 10px",
            background: "#fff",
          }}
        >
          {location.enabled ? "Hide" : "Show"}
        </button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const isSyncing =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sync";

  const result = fetcher.data as
    | {
        ok?: boolean;
        synced?: boolean;
        error?: string;
        summary?: {
          locationCount: number;
          productCounts: Record<string, number>;
        };
      }
    | undefined;

  return (
    <Page>
      <TitleBar title="Store Locations" />
      <BlockStack gap="500">
        {result?.synced && result.summary && (
          <Banner tone="success" title="Synced to storefront">
            <Text as="p">
              Published {result.summary.locationCount} store
              {result.summary.locationCount === 1 ? "" : "s"}. Available
              products per store:{" "}
              {Object.entries(result.summary.productCounts)
                .map(([name, count]) => `${name}: ${count}`)
                .join(", ")}
              .
            </Text>
          </Banner>
        )}
        {result && result.ok === false && (
          <Banner tone="critical" title="Sync failed">
            <Text as="p">{result.error}</Text>
          </Banner>
        )}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Floating store button
            </Text>
            <Checkbox
              label="Show the floating store button on the storefront (top-right)"
              checked={showFloatingButton}
              onChange={(next) => toggleFloating(next)}
            />
            <Text as="p" tone="subdued" variant="bodySm">
              Leave off if your theme already has its own store selector (the
              app follows the theme's selection automatically). Turn on to show
              our own floating "Select store" button in the top-right corner —
              it opens the store picker and filters products.
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Choose which stores appear in the popup
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              These are your Shopify locations (Settings → Locations).
              Shoppers will only see the ones marked "Shown in popup", and
              the storefront shows products with available inventory at the
              store they pick. To add or rename a store, edit it in your
              Shopify admin locations settings.
            </Text>
            <InlineStack>
              <fetcher.Form method="POST">
                <input type="hidden" name="intent" value="sync" />
                <Button submit variant="primary" loading={isSyncing}>
                  Sync to storefront
                </Button>
              </fetcher.Form>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Click after changing locations or inventory to refresh what
              shoppers see. (Toggling a store below also re-syncs
              automatically.)
            </Text>
          </BlockStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "location", plural: "locations" }}
            itemCount={locations.length}
            headings={[
              { title: "Name" },
              { title: "Address" },
              { title: "Popup" },
              { title: "Action" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
