import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getCustomer, getProduct, saveOrder, publishEvent } from "./deps";

type Line = { sku: string; qty: number };

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return { statusCode: 400, body: "missing body" };
    }
    const input = JSON.parse(event.body) as {
      customerId?: string;
      lines?: Line[];
      coupon?: string;
    };
    if (!input.customerId || !input.lines || input.lines.length === 0) {
      return { statusCode: 400, body: "invalid order" };
    }
    const customer = await getCustomer(input.customerId);
    if (customer) {
      if ((customer.blocked && !customer.isAdmin) || customer.region !== "EU") {
        return { statusCode: 403, body: "not allowed" };
      }
      let total = 0;
      for (const line of input.lines) {
        const product = await getProduct(line.sku);
        if (product) {
          if (product.stock >= line.qty) {
            total += product.price * line.qty;
          } else {
            return { statusCode: 409, body: `out of stock: ${line.sku}` };
          }
        } else {
          return { statusCode: 404, body: `unknown sku: ${line.sku}` };
        }
      }
      if (input.coupon) {
        total =
          input.coupon === "WELCOME10"
            ? total * 0.9
            : input.coupon === "VIP"
              ? total * 0.8
              : total;
      }
      const order = await saveOrder({
        customerId: customer.id,
        lines: input.lines,
        total,
      });
      await publishEvent("OrderCreated", order);
      return { statusCode: 201, body: JSON.stringify(order) };
    } else {
      return { statusCode: 404, body: "unknown customer" };
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { statusCode: 400, body: "malformed json" };
    }
    throw err;
  }
};

export function formatMoney(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
