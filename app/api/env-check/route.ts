export const runtime = "nodejs";

export async function GET() {
  const present = (v?: string) => (v && v.length > 0 ? "OK" : "MISSING");

  return Response.json({
    SUPABASE_URL: present(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: present(process.env.SUPABASE_SERVICE_ROLE_KEY),
    AMAZON_ACCESS_KEY: present(process.env.AMAZON_ACCESS_KEY),
    AMAZON_SECRET_KEY: present(process.env.AMAZON_SECRET_KEY),
    AMAZON_PARTNER_TAG: present(process.env.AMAZON_PARTNER_TAG),
    AMAZON_REGION: present(process.env.AMAZON_REGION),
    AMAZON_HOST: present(process.env.AMAZON_HOST),
    REFRESH_TOKEN: present(process.env.REFRESH_TOKEN),
  });
}
