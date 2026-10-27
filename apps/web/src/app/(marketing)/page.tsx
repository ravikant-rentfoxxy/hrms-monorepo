import { Header } from '@/marketing/components/site/header';
import { Footer } from '@/marketing/components/site/footer';
import { Hero } from '@/marketing/components/landing/hero';
import { Trust } from '@/marketing/components/landing/trust';
import { Features } from '@/marketing/components/landing/features';
import { Lifecycle } from '@/marketing/components/landing/lifecycle';
import { Showcase } from '@/marketing/components/landing/showcase';
import { Solutions } from '@/marketing/components/landing/solutions';
import { Benefits } from '@/marketing/components/landing/benefits';
import { HowItWorks } from '@/marketing/components/landing/how-it-works';
import { Pricing } from '@/marketing/components/landing/pricing';
import { Faq } from '@/marketing/components/landing/faq';
import { FinalCta } from '@/marketing/components/landing/final-cta';
import { FAQS } from '@/marketing/lib/content';
import type { Metadata } from 'next';
import { site } from '@/marketing/lib/site';

export const metadata: Metadata = {
  title: { absolute: `${site.name} — ${site.tagline} for hiring, attendance & payroll` },
  description: site.description,
  keywords: ['HRMS', 'HR software', 'payroll software India', 'attendance management', 'leave management', 'recruitment', 'onboarding', 'employee self-service'],
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name} — One Platform. Every Employee.`,
    description: site.description,
    url: '/',
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', title: `${site.name} — One Platform. Every Employee.`, description: site.description },
  alternates: { canonical: '/' },
};

/** FAQ structured data for search engines. */
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: site.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android, iOS',
  description: site.description,
};

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Trust />
        <Features />
        <Lifecycle />
        <Showcase />
        <Solutions />
        <Benefits />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([productJsonLd, faqJsonLd]) }} />
    </>
  );
}
