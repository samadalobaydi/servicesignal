# ServiceSignal

> Stop chasing late payments manually. ServiceSignal automatically follows up with customers who have unpaid invoices.

## What's in this repo

Landing page + beta signup form for ServiceSignal MVP.

Built with: **Next.js 14 · TypeScript · Tailwind CSS · Supabase**

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your Supabase keys (see below).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Supabase Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon/public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Run this SQL in the Supabase **SQL Editor**:

```sql
CREATE TABLE beta_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  business_type TEXT,
  unpaid_amount TEXT,
  willing_to_pay TEXT
);

ALTER TABLE beta_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert from anon" ON beta_signups FOR INSERT WITH CHECK (true);
```

> **Without Supabase:** The app still works in dev mode. Signups are printed to the console so you won't lose them.

---

## Project Structure

```
servicesignal/
├── app/
│   ├── api/
│   │   └── signup/
│   │       └── route.ts      ← Beta signup API endpoint
│   ├── globals.css            ← Global styles + design tokens
│   ├── layout.tsx             ← Root layout + metadata
│   └── page.tsx               ← Main page (assembles all sections)
│
├── components/
│   ├── Nav.tsx                ← Sticky navigation bar
│   ├── Hero.tsx               ← Hero section + mock dashboard
│   ├── Problem.tsx            ← Problem/pain point section
│   ├── HowItWorks.tsx         ← Step-by-step section
│   ├── Features.tsx           ← Feature cards
│   ├── WhoItsFor.tsx          ← Target audience
│   ├── Pricing.tsx            ← Pricing tiers
│   ├── FAQ.tsx                ← Accordion FAQ
│   ├── BetaSignup.tsx         ← Beta signup form
│   └── Footer.tsx             ← Site footer
│
├── lib/
│   └── supabase.ts            ← Supabase client + setup instructions
│
├── types/
│   └── index.ts               ← TypeScript types
│
├── .env.local.example         ← Environment variable template
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add your environment variables in the Vercel dashboard under **Settings → Environment Variables**.

---

## What's Not Built Yet (Next Steps)

The app structure is ready for these to be added:

| Feature | Status | Notes |
|---|---|---|
| Landing page | ✅ Done | |
| Beta signup form | ✅ Done | |
| Supabase storage | ✅ Wired | Add env vars to activate |
| User authentication | 🔜 Next | Supabase Auth |
| Dashboard layout | 🔜 Next | Protected route |
| Customer list | 🔜 Next | CRUD with Supabase |
| Invoice management | 🔜 Next | Add/edit/mark paid |
| Email reminders | 🔜 Next | Resend API |
| SMS reminders | 🔜 Next | Twilio or Vonage |
| Reminder scheduler | 🔜 Next | Cron via Vercel |
| Stripe payments | 🔜 Later | After beta |
| Mobile app | 🔜 Later | After web MVP |
| Xero / QuickBooks | 🔜 Later | After beta |

---

## Contact

hello@servicesignal.co.uk
