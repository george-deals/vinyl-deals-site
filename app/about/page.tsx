export default function AboutPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-slate-900 dark:text-slate-100">
      <h1 className="text-3xl font-bold mb-6">About</h1>

      <p className="mb-6 text-slate-700 dark:text-slate-300">
        Vinyl Deals is a simple site that helps you find discounts on{" "}
        <strong>new vinyl records</strong> sold on Amazon (US). We focus on
        surfacing the best value deals in one place.
      </p>

      <h2 className="text-xl font-semibold mt-10 mb-4">
        How deals are chosen
      </h2>

      <ul className="list-disc pl-6 space-y-2 text-slate-700 dark:text-slate-300">
        <li>We look for real price drops vs list price</li>
        <li>We prioritize popular formats (LPs, box sets, audiophile pressings)</li>
        <li>We exclude used listings</li>
      </ul>

      <h2 className="text-xl font-semibold mt-10 mb-4">
        Affiliate disclosure
      </h2>

      <p className="mb-6 text-slate-700 dark:text-slate-300">
        As an Amazon Associate I earn from qualifying purchases. This means if
        you click an Amazon link on this site and buy something, we may earn a
        small commission at no extra cost to you.
      </p>

      <h2 className="text-xl font-semibold mt-10 mb-4">Contact</h2>

      <p className="text-slate-700 dark:text-slate-300">
        Suggestions or issues? Email{" "}
        <span className="font-medium">contact@yourdomain.com</span>
        <br />
        <span className="text-sm opacity-70">
          (We’ll replace this once you choose a domain.)
        </span>
      </p>
    </main>
  );
}
