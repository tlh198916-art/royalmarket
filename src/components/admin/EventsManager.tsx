import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { formatDateTime } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Ticket,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type EventDoc = Doc<"marketEvents">;

function toLocalInputValue(ms: number): string {
  const shifted = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error: /, "")
    : "Something went wrong — please try again.";
}

/** Create/edit form; state initializes lazily from props (no effects). */
function EventForm({
  event,
  onDone,
}: {
  event: EventDoc | null;
  onDone: () => void;
}) {
  const create = useMutation(api.marketEvents.adminCreate);
  const update = useMutation(api.marketEvents.adminUpdate);

  const [title, setTitle] = useState(event?.title ?? "");
  const [tagline, setTagline] = useState(event?.tagline ?? "");
  const [detailsText, setDetailsText] = useState(event?.details.join("\n") ?? "");
  const [startsAtLocal, setStartsAtLocal] = useState(() =>
    toLocalInputValue(event?.startsAt ?? Date.now() + 7 * 86_400_000),
  );
  const [duration, setDuration] = useState(String(event?.durationMinutes ?? 90));
  const [joinInstructions, setJoinInstructions] = useState(
    event?.joinInstructions ?? "",
  );
  const [joinUrl, setJoinUrl] = useState(event?.joinUrl ?? "");
  const [status, setStatus] = useState<"draft" | "published" | "cancelled">(
    event?.status ?? "draft",
  );
  const [publishNow, setPublishNow] = useState(event?.status === "published");
  const [saving, setSaving] = useState(false);

  const submit = async (event_: React.FormEvent<HTMLFormElement>) => {
    event_.preventDefault();
    setSaving(true);
    const payload = {
      title,
      tagline,
      details: detailsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      startsAt: fromLocalInputValue(startsAtLocal),
      durationMinutes: Number(duration),
      joinInstructions,
      joinUrl: joinUrl.trim() || undefined,
    };
    try {
      if (event) {
        await update({ eventId: event._id, ...payload, status });
        toast.success("Event updated.");
      } else {
        await create({ ...payload, publish: publishNow });
        toast.success(publishNow ? "Event published." : "Draft created.");
      }
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-primary/30 bg-secondary/30 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-title">Title</Label>
          <Input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Founding Sellers Launch Event"
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-tagline">Tagline</Label>
          <Input
            id="ev-tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="One-line description shown under the title"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-start">Starts at (your local time)</Label>
          <Input
            id="ev-start"
            type="datetime-local"
            value={startsAtLocal}
            onChange={(e) => setStartsAtLocal(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-duration">Duration (minutes)</Label>
          <Input
            id="ev-duration"
            type="number"
            min={15}
            max={480}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-details">Agenda — one item per line</Label>
          <Textarea
            id="ev-details"
            rows={4}
            value={detailsText}
            onChange={(e) => setDetailsText(e.target.value)}
            placeholder={"Live walkthrough of listing an item\nOpen Q&A"}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-join">Online attendance details</Label>
          <Textarea
            id="ev-join"
            rows={2}
            value={joinInstructions}
            onChange={(e) => setJoinInstructions(e.target.value)}
            placeholder="How registered attendees join (shown on the public page)"
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ev-url">
            Private join link (optional — shown only to registered attendees)
          </Label>
          <Input
            id="ev-url"
            type="url"
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        {event ? (
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as "draft" | "published" | "cancelled")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="ev-publish"
              checked={publishNow}
              onCheckedChange={(checked) => setPublishNow(checked === true)}
            />
            <Label htmlFor="ev-publish" className="font-normal">
              Publish immediately
            </Label>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          {event ? "Save changes" : "Create event"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          <X className="mr-1.5 size-4" /> Cancel
        </Button>
      </div>
    </form>
  );
}

const STATUS_STYLES: Record<EventDoc["status"], string> = {
  draft: "border-border/70 text-muted-foreground",
  published: "border-emerald-400/50 text-emerald-300",
  cancelled: "border-red-400/50 text-red-300",
};

/**
 * Admin-only event management: create, edit, publish, and cancel events, plus
 * registration and seller-conversion tracking. Mounted on the Admin page
 * (requireAdmin is enforced again server-side on every call).
 */
export function EventsManager() {
  const events = useQuery(api.marketEvents.adminList);
  const stats = useQuery(api.marketEvents.adminStats);
  const update = useMutation(api.marketEvents.adminUpdate);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const changeStatus = async (row: EventDoc, status: EventDoc["status"]) => {
    try {
      await update({
        eventId: row._id,
        title: row.title,
        tagline: row.tagline,
        details: row.details,
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        joinInstructions: row.joinInstructions,
        joinUrl: row.joinUrl,
        status,
      });
      toast.success(
        status === "published"
          ? "Event published."
          : status === "cancelled"
            ? "Event cancelled — it now shows as cancelled publicly."
            : "Event moved back to draft.",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <Megaphone className="size-4 text-primary" /> Event management
        </h2>
        <Button size="sm" onClick={() => setCreating((open) => !open)}>
          {creating ? (
            <X className="mr-1.5 size-4" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          {creating ? "Close" : "New event"}
        </Button>
      </div>

      {stats && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Events", value: stats.totalEvents },
            { label: "Registrations", value: stats.totalRegistrations },
            { label: "Unique registrants", value: stats.uniqueRegistrants },
            { label: "Became sellers", value: stats.becameSellers },
          ].map((tile) => (
            <div
              key={tile.label}
              className="rounded-xl border border-border/70 bg-secondary/30 p-3"
            >
              <p className="text-lg font-extrabold tabular-nums">{tile.value}</p>
              <p className="text-[11px] font-medium text-muted-foreground">
                {tile.label}
              </p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <TrendingUp className="size-3.5" /> &quot;Became sellers&quot; counts
        registrants who later created a seller account on the marketplace.
      </p>

      {creating && (
        <div className="mt-4">
          <EventForm event={null} onDone={() => setCreating(false)} />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {events === undefined && (
          <div className="h-20 animate-pulse rounded-xl bg-secondary/40" />
        )}
        {events?.length === 0 && (
          <p className="rounded-xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
            No events yet — the public page currently shows the built-in
            Founding Sellers Launch Event. Create an event here to customize or
            replace it.
          </p>
        )}
        {events?.map((row) => (
          <div
            key={row._id}
            className="rounded-xl border border-border/70 bg-secondary/20 p-4"
          >
            {editingId === row._id ? (
              <EventForm
                event={row}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{row.title}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      {formatDateTime(row.startsAt)} · {row.durationMinutes} min
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Ticket className="size-3.5" /> /{row.slug}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" /> {row.registrations}{" "}
                      registered · {row.becameSellers} became sellers
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(row._id)}
                  >
                    <Pencil className="mr-1.5 size-3.5" /> Edit
                  </Button>
                  {row.status !== "published" && (
                    <Button size="sm" onClick={() => changeStatus(row, "published")}>
                      Publish
                    </Button>
                  )}
                  {row.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-400/40 text-red-300"
                      onClick={() => changeStatus(row, "cancelled")}
                    >
                      Cancel event
                    </Button>
                  )}
                  {row.status === "cancelled" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => changeStatus(row, "draft")}
                    >
                      Back to draft
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
