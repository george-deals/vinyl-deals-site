export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Terms of Use</h1>

        <p className="mt-4 text-slate-700">
          Vinyl Deals is provided “as is” without warranties of any kind. Pricing and availability can change at any time
          on Amazon, and we can’t guarantee accuracy.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Affiliate relationship</h2>
        <p className="mt-3 text-slate-700">
          Some links are affiliate links. We may earn a commission from qualifying purchases.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Limitation of liability</h2>
        <p className="mt-3 text-slate-700">
          To the fullest extent permitted by law, we are not liable for any damages arising from your use of this site.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Contact</h2>
        <p className="mt-3 text-slate-700">
          Questions? Email <span className="font-medium">contact@yourdomain.com</span>.
        </p>
      </div>
    </main>
  );
}
