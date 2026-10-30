import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTime } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Order-scoped conversation between the buyer and the seller(s). Collapsed by
 * default so dense order lists stay readable; the thread itself is private to
 * the people on the order.
 */
export function OrderMessages({ orderId }: { orderId: Id<"orders"> }) {
  const thread = useQuery(api.orders.messages, { orderId });
  const sendMessage = useMutation(api.orders.sendMessage);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  if (!thread) return null;

  const count = thread.messages.length;

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendMessage({ orderId, body });
      setBody("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the message.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border/70 pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="size-3.5" />
        Messages{count > 0 ? ` (${count})` : ""}
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {count === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              No messages yet. Ask about pickup details, shipping, or the item
              itself — the other side of this order sees it here.
            </p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border/70 bg-background/40 p-3">
              {thread.messages.map((message) => (
                <div
                  key={message._id}
                  className={
                    message.mine
                      ? "ml-auto max-w-[85%] rounded-xl bg-primary/15 px-3 py-2"
                      : "mr-auto max-w-[85%] rounded-xl bg-secondary/70 px-3 py-2"
                  }
                >
                  <p className="whitespace-pre-wrap text-xs leading-5">
                    {message.body}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {message.mine ? "You" : message.senderName} ·{" "}
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              maxLength={1000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Write a message about this order"
              className="min-h-0 text-sm"
              aria-label="Message about this order"
            />
            <Button
              size="icon"
              onClick={() => void handleSend()}
              disabled={sending || !body.trim()}
              aria-label="Send message"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
