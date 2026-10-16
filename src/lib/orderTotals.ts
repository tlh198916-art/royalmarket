/**
 * Pure checkout totals math, extracted from the Checkout page so the fee
 * rules are unit-testable.
 *
 * Rules encoded here:
 * - Items subtotal counts only live rows with a positive quantity.
 * - Fees are one seller-set fee per seller group — never per item, never a
 *   platform markup. The chosen method's fee (or 0 when unknown/free, e.g.
 *   pickup) is added once per seller.
 */

export type TotalsLine = {
  /** The live listing document when it still exists (truthy), else null. */
  live: unknown;
  quantity: number;
  effectivePriceCents: number;
};

export type TotalsMethodGroup<TMethod extends string = string> = {
  sellerId: string;
  methods: { method: TMethod; feeCents: number }[];
};

export function computeCheckoutTotals<TMethod extends string>(args: {
  lines: readonly TotalsLine[];
  groups: readonly TotalsMethodGroup<TMethod>[];
  choices: Readonly<Record<string, TMethod | undefined>>;
}): {
  itemsSubtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
} {
  let itemsSubtotalCents = 0;
  for (const line of args.lines) {
    if (!line.live || line.quantity === 0) continue;
    itemsSubtotalCents += line.effectivePriceCents * line.quantity;
  }

  let shippingFeeCents = 0;
  for (const group of args.groups) {
    const chosen = group.methods.find(
      (m) => m.method === args.choices[group.sellerId],
    );
    shippingFeeCents += chosen?.feeCents ?? 0;
  }

  return {
    itemsSubtotalCents,
    shippingFeeCents,
    totalCents: itemsSubtotalCents + shippingFeeCents,
  };
}
