export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>

        <p className="mt-4 text-slate-700">
          We don’t sell your personal information. This site may use cookies and similar technologies for basic
          analytics and performance monitoring, and may include affiliate links to Amazon.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Affiliate links</h2>
        <p className="mt-3 text-slate-700">
          When you click an Amazon link and purchase a product, we may earn a commission. Amazon may use cookies
          to track referrals.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Analytics</h2>
        <p className="mt-3 text-slate-700">
          In the future, we may use analytics tools to understand which pages are helpful. These tools may collect
          non-identifying usage data (like page views).
        </p>

        <h2 className="mt-10 text-xl font-semibold">Contact</h2>
        <p className="mt-3 text-slate-700">
          Questions? Email <span className="font-medium">contact@yourdomain.com</span>.
        </p>

        <p className="mt-10 text-sm text-slate-500">Last updated: {new Date().toLocaleDateString()}</p>
      </div>
    </main>
  );
}
