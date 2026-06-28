import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  List,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query LocationCount {
        locations(first: 50, includeInactive: false) {
          nodes { id }
        }
      }`,
  );
  const json = await response.json();
  const locationCount = json.data?.locations?.nodes?.length ?? 0;
  return { locationCount };
};

export default function Index() {
  const { locationCount } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Store Selector" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Welcome to Store Selector
                </Text>
                <Text as="p" variant="bodyMd">
                  {`You have ${locationCount} Shopify location${
                    locationCount === 1 ? "" : "s"
                  }.`}
                </Text>
                <List type="number">
                  <List.Item>
                    Pick which locations show in the storefront popup on the{" "}
                    <Link url="/app/locations">Store Locations</Link> page.
                  </List.Item>
                  <List.Item>
                    Make sure each product has inventory assigned to its
                    location(s) in Shopify admin — the storefront shows only
                    products available at the shopper's selected store.
                  </List.Item>
                  <List.Item>
                    In your theme editor, add the "Store Selector" app embed
                    from this app so shoppers see the location popup and can
                    switch stores any time.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
