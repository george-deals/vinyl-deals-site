export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Contact</h1>
        <p className="mt-4 text-slate-700">
          Have a suggestion, found an issue, or want to request a category?
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 p-6">
          <p className="text-slate-700">
            Email: <span className="font-medium">contact@yourdomain.com</span>
          </p>
          <p className="mt-2 text-sm text-slate-500">
            (Replace this with your real email once you pick a domain.)
          </p>
        </div>
      </div>
    </main>
  );
}
