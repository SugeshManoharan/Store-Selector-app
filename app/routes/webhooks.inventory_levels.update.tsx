import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { maybeSyncThrottled } from "../sync.server";

// Fires whenever inventory changes. We run a throttled re-sync so bursts of
// changes don't trigger a sync per event. Kept small so the handler returns
// well within Shopify's webhook timeout.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (admin) {
    try {
      await maybeSyncThrottled(admin.graphql, shop);
    } catch (e) {
      console.error(`Auto-sync failed for ${shop}:`, e);
    }
  }

  return new Response();
};
