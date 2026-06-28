import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// No customer data is stored by this app, so there is nothing to redact.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  return new Response();
};
