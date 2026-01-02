export const metadata = {
  title: "About Vinyl Deals",
  description:
    "Learn how Vinyl Deals works, how we select deals, and read our affiliate disclosure.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">About</h1>

        <p className="mt-4 text-neutral-700 dark:text-neutral-300">
          Vinyl Deals is a simple site that helps you find discounts on <strong>new</strong>{" "}
          vinyl records sold on Amazon (US). We focus on surfacing the best value deals
          in one place.
        </p>

        <h2 className="mt-10 text-xl font-semibold">How deals are chosen</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-neutral-700 dark:text-neutral-300">
          <li>We look for price drops and strong discounts vs list price.</li>
          <li>We prioritize popular formats (LPs, box sets, audiophile pressings).</li>
          <li>We exclude used listings.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Affiliate disclosure</h2>
        <p className="mt-4 text-neutral-700 dark:text-neutral-300">
          As an Amazon Associate I earn from qualifying purchases. This means if you click an
          Amazon link on this site and buy something, we may earn a small commission at no
          extra cost to you.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Contact</h2>
        <p className="mt-4 text-neutral-700 dark:text-neutral-300">
          If you’d like to suggest a category or report an issue, email:{" "}
          <span className="font-medium">contact@yourdomain.com</span>
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          (We’ll replace this with your real domain email once you pick a domain.)
        </p>
      </div>
    </main>
  );
}
