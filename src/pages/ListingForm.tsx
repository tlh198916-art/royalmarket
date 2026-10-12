import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/categories";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice, parsePriceToCents } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Save,
  Send,
  Store,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

type Photo = {
  localId: string;
  storageId: string | null;
  previewUrl: string;
  uploading: boolean;
};

type FormState = {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  price: string;
  quantity: string;
  shippingFee: string;
  shipsFrom: string;
  estimatedDays: string;
  returnsAccepted: boolean;
  returnDays: string;
};

const emptyForm: FormState = {
  title: "",
  description: "",
  categoryId: "",
  condition: "good",
  price: "",
  quantity: "1",
  shippingFee: "0",
  shipsFrom: "",
  estimatedDays: "5",
  returnsAccepted: false,
  returnDays: "14",
};

function validate(form: FormState): string | null {
  if (form.title.trim().length < 3) return "Title must be at least 3 characters.";
  if (form.title.length > 100) return "Title must be 100 characters or fewer.";
  if (form.description.trim().length < 10)
    return "Description must be at least 10 characters.";
  if (form.description.length > 5000)
    return "Description must be 5000 characters or fewer.";
  if (!form.categoryId) return "Choose a category.";
  const price = parsePriceToCents(form.price);
  if (price === null || price < 50) return "Enter a price of at least $0.50.";
  if (price > 10_000_000) return "Price must be $100,000 or less.";
  const quantity = Number(form.quantity);
  if (!Number.isInteger(quantity) || quantity < 0)
    return "Inventory must be a whole number of 0 or more.";
  const fee = parsePriceToCents(form.shippingFee || "0");
  if (fee === null || fee > 100_000)
    return "Shipping fee must be between $0 and $1,000.";
  const days = Number(form.estimatedDays);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    return "Estimated shipping must be 1–90 days.";
  if (form.returnsAccepted) {
    const returnDays = Number(form.returnDays);
    if (!Number.isInteger(returnDays) || returnDays < 1 || returnDays > 90)
      return "Return window must be 1–90 days.";
  }
  return null;
}

export default function ListingForm() {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const myListings = useQuery(api.products.myListings);
  const existing =
    editId && myListings
      ? myListings.find((p) => p._id === editId)
      : undefined;

  const becomeSeller = useMutation(api.sellers.become);
  const updateProfile = useMutation(api.sellers.updateProfile);
  const createListing = useMutation(api.products.create);
  const updateListing = useMutation(api.products.update);
  const generateUploadUrl = useMutation(api.products.generateUploadUrl);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [publish, setPublish] = useState(true);
  const [shopStep, setShopStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  // Shop setup step for first-time sellers.
  useEffect(() => {
    if (authLoading || !user) return;
    if (!user.isSeller) setShopStep(true);
  }, [user, authLoading]);

  // Prefill when editing an existing listing.
  useEffect(() => {
    if (!editId || !myListings) return;
    const product = myListings.find((p) => p._id === editId);
    if (!product) return;
    setForm({
      title: product.title,
      description: product.description ?? "",
      categoryId: product.categoryId,
      condition: product.condition ?? "good",
      price: (product.priceCents / 100).toFixed(2),
      quantity: String(product.quantity),
      shippingFee: ((product.shipping?.flatFeeCents ?? 0) / 100).toFixed(2),
      shipsFrom: product.shipping?.shipsFrom ?? "",
      estimatedDays: String(product.shipping?.estimatedDays ?? 5),
      returnsAccepted: product.returns?.accepted ?? false,
      returnDays: String(product.returns?.days ?? 14),
    });
    setPublish(product.status === "active");
  }, [editId, myListings]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleShopSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const shopName = String(formData.get("shopName") ?? "").trim();
    const bio = String(formData.get("bio") ?? "").trim();
    const location = String(formData.get("location") ?? "").trim();
    setSubmitting(true);
    try {
      if (user?.isSeller) {
        await updateProfile({ shopName, bio, location });
      } else {
        await becomeSeller({ shopName, bio, location });
      }
      setShopStep(false);
      toast.success("Shop profile saved — now create your listing.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save your shop.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const room = 8 - photos.length;
    const files = Array.from(fileList).slice(0, room);
    if (files.length === 0) {
      toast.error("You can upload up to 8 photos per listing.");
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image.`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than 5MB.`);
        continue;
      }
      const localId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      setPhotos((prev) => [
        ...prev,
        { localId, storageId: null, previewUrl, uploading: true },
      ]);
      setUploadingCount((count) => count + 1);
      try {
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
        const json = (await response.json()) as { storageId: string };
        setPhotos((prev) =>
          prev.map((photo) =>
            photo.localId === localId
              ? { ...photo, storageId: json.storageId, uploading: false }
              : photo,
          ),
        );
      } catch (error) {
        setPhotos((prev) =>
          prev.filter((photo) => photo.localId !== localId),
        );
        URL.revokeObjectURL(previewUrl);
        toast.error(
          error instanceof Error ? error.message : "Photo upload failed.",
        );
      } finally {
        setUploadingCount((count) => count - 1);
      }
    }
  };

  const removePhoto = (localId: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const doSubmit = async (publishNow: boolean) => {
    const error = validate(form);
    if (error) {
      toast.error(error);
      return;
    }
    if (uploadingCount > 0) {
      toast.error("Wait for photo uploads to finish.");
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId,
      priceCents: parsePriceToCents(form.price) ?? 0,
      quantity: Number(form.quantity),
      condition: form.condition as "new" | "like_new" | "good" | "fair",
      imageStorageIds: photos
        .map((photo) => photo.storageId)
        .filter((id): id is string => Boolean(id)),
      shipping: {
        flatFeeCents: parsePriceToCents(form.shippingFee || "0") ?? 0,
        shipsFrom: form.shipsFrom.trim() || undefined,
        estimatedDays: Number(form.estimatedDays),
      },
      returns: {
        accepted: form.returnsAccepted,
        days: form.returnsAccepted ? Number(form.returnDays) : 0,
      },
    };

    setSubmitting(true);
    try {
      if (editId && existing) {
        await updateListing({
          id: existing._id,
          ...payload,
          status: publishNow ? "active" : "draft",
        });
        toast.success(
          publishNow ? "Listing updated and live." : "Draft saved.",
        );
      } else {
        await createListing({ ...payload, publish: publishNow });
        toast.success(
          publishNow ? "Your listing is live!" : "Draft saved to your dashboard.",
        );
      }
      navigate("/sell/dashboard");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the listing.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || (editId && myListings === undefined)) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (editId && !existing && myListings !== undefined) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Store}
            title="Listing not found"
            description="That listing isn't in your shop. It may have been deleted."
            action={
              <Button asChild>
                <Link to="/sell/dashboard">Back to dashboard</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  // Step 1: shop onboarding (first-time sellers only).
  if (shopStep && !user?.isSeller) {
    return (
      <Layout>
        <div className="page-container max-w-xl py-12">
          <Badge
            variant="secondary"
            className="border border-primary/30 bg-primary/10 text-primary"
          >
            Step 1 of 2 · Shop setup
          </Badge>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Name your shop
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your shop name appears on every listing and on your public seller
            profile. It&apos;s free and you can change it later.
          </p>

          <form onSubmit={handleShopSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="shopName">Shop name *</Label>
              <Input
                id="shopName"
                name="shopName"
                required
                minLength={2}
                maxLength={60}
                placeholder="e.g. Harbor Vintage Co."
                defaultValue={user?.shopName ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bio">Short bio</Label>
              <Textarea
                id="bio"
                name="bio"
                rows={3}
                maxLength={500}
                placeholder="What do you sell, and why should buyers trust your shop?"
                defaultValue={user?.sellerBio ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                name="location"
                maxLength={80}
                placeholder="City, Country"
                defaultValue={user?.location ?? ""}
              />
            </div>

            {user && !user.emailVerificationTime && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-5">
                Your email isn&apos;t verified yet — verify it from the sign-in
                screen before listings can go live.
              </p>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? "Saving…" : "Continue to listing"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShopStep(false)}
              >
                Skip for now
              </Button>
            </div>
          </form>
        </div>
      </Layout>
    );
  }

  const priceCents = parsePriceToCents(form.price) ?? 0;
  const category = CATEGORIES.find((c) => c.id === form.categoryId);

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <Link
          to="/sell/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Seller dashboard
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {editId ? "Edit listing" : "Create a listing"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Free to post · instant publish · no approval queue
            </p>
          </div>
          {!user?.isSeller && (
            <Button variant="outline" size="sm" onClick={() => setShopStep(true)}>
              <Store className="mr-2 size-4" /> Set up shop first
            </Button>
          )}
        </div>

        {existing?.status === "removed" && (
          <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
            This listing was taken down by a moderator. You can edit it, but
            only an admin can make it live again — please open a support
            ticket for the reason.
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void doSubmit(publish);
          }}
          className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]"
        >
          {/* Main form */}
          <div className="space-y-8">
            {/* Photos */}
            <section className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="text-sm font-bold tracking-tight">Photos</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Up to 8 images, 5MB each. The first photo is the cover.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {photos.map((photo) => (
                  <div
                    key={photo.localId}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-border/70 bg-secondary/40"
                  >
                    <img
                      src={photo.previewUrl}
                      alt="Upload preview"
                      className="h-full w-full object-cover"
                    />
                    {photo.uploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="size-5 animate-spin text-primary" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.localId)}
                      aria-label="Remove photo"
                      className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg bg-background/85 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                {photos.length < 8 && (
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-background/40 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
                    <ImagePlus className="size-5" />
                    <span className="text-[11px] font-medium">Add photos</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        void handleFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </section>

            {/* Basics */}
            <section className="rounded-2xl border border-border/70 bg-card p-6 space-y-5">
              <h2 className="text-sm font-bold tracking-tight">Details</h2>
              <div className="space-y-1.5">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(event) => set("title", event.target.value)}
                  maxLength={100}
                  placeholder="e.g. Vintage leather satchel — barely used"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {form.title.length}/100
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder="Describe condition, size, what's included, and any flaws honestly."
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {form.description.length}/5000
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Category *</Label>
                  <Select
                    value={form.categoryId}
                    onValueChange={(value) => set("categoryId", value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.emoji} {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Condition *</Label>
                  <Select
                    value={form.condition}
                    onValueChange={(value) => set("condition", value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="like_new">Like new</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Pricing & inventory */}
            <section className="rounded-2xl border border-border/70 bg-card p-6 space-y-5">
              <h2 className="text-sm font-bold tracking-tight">
                Pricing &amp; inventory
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price (USD) *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="price"
                      type="number"
                      min="0.5"
                      step="0.01"
                      value={form.price}
                      onChange={(event) => set("price", event.target.value)}
                      className="pl-7"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">Inventory (units) *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    step="1"
                    value={form.quantity}
                    onChange={(event) => set("quantity", event.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Set 0 if it&apos;s sold out for now.
                  </p>
                </div>
              </div>
            </section>

            {/* Shipping & returns */}
            <section className="rounded-2xl border border-border/70 bg-card p-6 space-y-5">
              <h2 className="text-sm font-bold tracking-tight">
                Shipping &amp; returns
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="shippingFee">Flat shipping fee (USD)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="shippingFee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.shippingFee}
                      onChange={(event) =>
                        set("shippingFee", event.target.value)
                      }
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Charged once per order. 0 = free shipping.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="estimatedDays">Dispatch time (days)</Label>
                  <Input
                    id="estimatedDays"
                    type="number"
                    min="1"
                    max="90"
                    step="1"
                    value={form.estimatedDays}
                    onChange={(event) =>
                      set("estimatedDays", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shipsFrom">Ships from</Label>
                  <Input
                    id="shipsFrom"
                    maxLength={80}
                    value={form.shipsFrom}
                    onChange={(event) => set("shipsFrom", event.target.value)}
                    placeholder="City, Country"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Accept returns</p>
                  <p className="text-xs text-muted-foreground">
                    Shown on your product page before checkout.
                  </p>
                </div>
                <Switch
                  checked={form.returnsAccepted}
                  onCheckedChange={(checked) =>
                    set("returnsAccepted", checked)
                  }
                />
              </div>
              {form.returnsAccepted && (
                <div className="max-w-[220px] space-y-1.5">
                  <Label htmlFor="returnDays">Return window (days)</Label>
                  <Input
                    id="returnDays"
                    type="number"
                    min="1"
                    max="90"
                    step="1"
                    value={form.returnDays}
                    onChange={(event) => set("returnDays", event.target.value)}
                  />
                </div>
              )}
            </section>

            {/* Submit bar */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                disabled={submitting || uploadingCount > 0}
                onClick={() => void doSubmit(true)}
                className="flex-1"
              >
                {submitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                {editId ? "Save & keep live" : "Publish listing"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={submitting || uploadingCount > 0}
                onClick={() => void doSubmit(false)}
                className="flex-1"
              >
                <Save className="mr-2 size-4" />
                Save as draft
              </Button>
            </div>
          </div>

          {/* Live preview */}
          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-border/70 bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Live preview
              </p>
              <div className="mt-3 aspect-[4/3] overflow-hidden rounded-xl border border-border/70 bg-secondary/40">
                <ProductMedia
                  imageUrl={photos.find((p) => p.storageId)?.previewUrl ?? null}
                  categoryId={form.categoryId}
                  title={form.title || "Your listing title"}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {category ? `${category.emoji} ${category.label}` : "Category"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-semibold">
                {form.title || "Your listing title"}
              </p>
              <p className="mt-1.5 text-lg font-bold">
                {formatPrice(priceCents)}
              </p>
              <p className="text-xs text-muted-foreground">
                {(parsePriceToCents(form.shippingFee || "0") ?? 0) > 0
                  ? `+ ${formatPrice(parsePriceToCents(form.shippingFee || "0") ?? 0)} shipping`
                  : "Free shipping"}{" "}
                · arrives ~{form.estimatedDays || "?"} days
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="capitalize">
                  {form.condition.replace("_", " ")}
                </Badge>
                <Badge variant="outline">
                  {form.quantity || "0"} in stock
                </Badge>
                {form.returnsAccepted && (
                  <Badge variant="outline">
                    {form.returnDays}-day returns
                  </Badge>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card p-5 text-xs leading-5 text-muted-foreground">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <CheckCircle2 className="size-3.5 text-primary" /> Before you
                publish
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Use real photos of the actual item</li>
                <li>Be honest about flaws — it prevents returns</li>
                <li>Stock counts update live at checkout</li>
                <li>Listings publish instantly (no approval wait)</li>
              </ul>
            </div>
          </aside>
        </form>
      </div>
    </Layout>
  );
}
