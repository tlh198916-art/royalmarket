import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPrice, parsePriceToCents } from "@/lib/format";
import { Handshake, MapPin, Truck } from "lucide-react";

export type FulfillmentSettings = {
  pickup: {
    enabled: boolean;
    area?: string;
    instructions?: string;
  };
  shipping: {
    enabled: boolean;
    feeCents: number;
    handlingDays: number;
    carrier?: string;
    method?: string;
  };
  delivery: {
    enabled: boolean;
    feeCents: number;
    area?: string;
    estimatedDays?: number;
    contactRequired: boolean;
  };
};

export const defaultFulfillment: FulfillmentSettings = {
  pickup: { enabled: true },
  shipping: { enabled: true, feeCents: 0, handlingDays: 3 },
  delivery: {
    enabled: false,
    feeCents: 0,
    contactRequired: true,
  },
};

/**
 * Compact, phone-friendly editor for a seller's fulfillment options.
 * Used per-listing and for seller-level defaults. Fees are seller-set;
 * pickup is always free and never exposes a home address.
 */
export function FulfillmentEditor({
  value,
  onChange,
  idPrefix = "ff",
}: {
  value: FulfillmentSettings;
  onChange: (next: FulfillmentSettings) => void;
  idPrefix?: string;
}) {
  const set = <K extends keyof FulfillmentSettings>(
    key: K,
    next: Partial<FulfillmentSettings[K]>,
  ) => onChange({ ...value, [key]: { ...value[key], ...next } });

  return (
    <div className="space-y-4">
      {/* Local pickup */}
      <div
        className={`rounded-xl border p-4 transition-colors ${
          value.pickup.enabled
            ? "border-primary/50 bg-primary/5"
            : "border-border/70 bg-background/40"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Handshake className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Local pickup</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Buyers meet you in your area. Free — pickup details are shared
                only after an order is placed, never publicly.
              </p>
            </div>
          </div>
          <Switch
            checked={value.pickup.enabled}
            onCheckedChange={(checked) => set("pickup", { enabled: checked })}
            aria-label="Enable local pickup"
          />
        </div>
        {value.pickup.enabled && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-pickup-area`}>
                Pickup city or area *
              </Label>
              <Input
                id={`${idPrefix}-pickup-area`}
                value={value.pickup.area ?? ""}
                onChange={(e) => set("pickup", { area: e.target.value })}
                maxLength={120}
                placeholder="e.g. Downtown Austin — public meetup spots only"
              />
              <p className="text-xs text-muted-foreground">
                Use a city or neighborhood — never your home address.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-pickup-instructions`}>
                Pickup instructions (optional)
              </Label>
              <Input
                id={`${idPrefix}-pickup-instructions`}
                value={value.pickup.instructions ?? ""}
                onChange={(e) =>
                  set("pickup", { instructions: e.target.value })
                }
                maxLength={500}
                placeholder="e.g. Weekday evenings at the library plaza"
              />
            </div>
          </div>
        )}
      </div>

      {/* Seller-arranged shipping */}
      <div
        className={`rounded-xl border p-4 transition-colors ${
          value.shipping.enabled
            ? "border-primary/50 bg-primary/5"
            : "border-border/70 bg-background/40"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Truck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Shipping</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                You handle packing, carrier, and cost yourself. Set your fee —
                or offer free shipping.
              </p>
            </div>
          </div>
          <Switch
            checked={value.shipping.enabled}
            onCheckedChange={(checked) =>
              set("shipping", { enabled: checked })
            }
            aria-label="Enable shipping"
          />
        </div>
        {value.shipping.enabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-ship-fee`}>
                Shipping fee (USD)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id={`${idPrefix}-ship-fee`}
                  type="number"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={(value.shipping.feeCents / 100).toFixed(2)}
                  onChange={(e) =>
                    set("shipping", {
                      feeCents: parsePriceToCents(e.target.value) ?? 0,
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {value.shipping.feeCents === 0
                  ? "Free shipping"
                  : `Buyers see ${formatPrice(value.shipping.feeCents)} before checkout`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-ship-handling`}>
                Handling time (days)
              </Label>
              <Input
                id={`${idPrefix}-ship-handling`}
                type="number"
                min="0"
                max="60"
                step="1"
                value={value.shipping.handlingDays}
                onChange={(e) =>
                  set("shipping", {
                    handlingDays: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Estimated time before dispatch — not a delivery guarantee.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-ship-carrier`}>
                Carrier (optional)
              </Label>
              <Input
                id={`${idPrefix}-ship-carrier`}
                value={value.shipping.carrier ?? ""}
                onChange={(e) => set("shipping", { carrier: e.target.value })}
                maxLength={60}
                placeholder="e.g. USPS, UPS, FedEx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-ship-method`}>
                Shipping method (optional)
              </Label>
              <Input
                id={`${idPrefix}-ship-method`}
                value={value.shipping.method ?? ""}
                onChange={(e) => set("shipping", { method: e.target.value })}
                maxLength={60}
                placeholder="e.g. Ground, Priority, Local courier"
              />
            </div>
          </div>
        )}
      </div>

      {/* Seller-arranged local delivery */}
      <div
        className={`rounded-xl border p-4 transition-colors ${
          value.delivery.enabled
            ? "border-primary/50 bg-primary/5"
            : "border-border/70 bg-background/40"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Local delivery</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                You deliver within your own area and set the fee — or deliver
                free.
              </p>
            </div>
          </div>
          <Switch
            checked={value.delivery.enabled}
            onCheckedChange={(checked) =>
              set("delivery", { enabled: checked })
            }
            aria-label="Enable local delivery"
          />
        </div>
        {value.delivery.enabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-del-fee`}>
                Delivery fee (USD)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id={`${idPrefix}-del-fee`}
                  type="number"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={(value.delivery.feeCents / 100).toFixed(2)}
                  onChange={(e) =>
                    set("delivery", {
                      feeCents: parsePriceToCents(e.target.value) ?? 0,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-del-area`}>
                Delivery area *
              </Label>
              <Input
                id={`${idPrefix}-del-area`}
                value={value.delivery.area ?? ""}
                onChange={(e) => set("delivery", { area: e.target.value })}
                maxLength={120}
                placeholder="e.g. Within 15 miles of Springfield"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-del-days`}>
                Estimated delivery (days, optional)
              </Label>
              <Input
                id={`${idPrefix}-del-days`}
                type="number"
                min="0"
                max="60"
                step="1"
                value={value.delivery.estimatedDays ?? ""}
                onChange={(e) =>
                  set("delivery", {
                    estimatedDays:
                      e.target.value === ""
                        ? undefined
                        : Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3.5 py-2.5 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">
                  Buyer contacts me to arrange delivery
                </p>
                <p className="text-xs text-muted-foreground">
                  Recommended — you agree on a time and place directly.
                </p>
              </div>
              <Switch
                checked={value.delivery.contactRequired}
                onCheckedChange={(checked) =>
                  set("delivery", { contactRequired: checked })
                }
                aria-label="Require buyer contact for delivery"
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        You can enable more than one option — buyers choose at checkout. Fees
        you set are added once per order; the platform charges no shipping
        service fee.
      </p>
    </div>
  );
}
