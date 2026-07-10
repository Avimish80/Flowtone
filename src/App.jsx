import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AuthGate from '@/components/auth/AuthGate';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import { lazy, Suspense, useEffect } from 'react';
import { saveGmailTokens } from '@/lib/gmailClient';

// Public prospect-facing pages (no auth, no app shell). Kept as lazy chunks
// so the authenticated app never pays for them and vice versa.
const PublicEnquiryPage = lazy(() => import('./pages/public/PublicEnquiryPage'));
const PublicQuotePage = lazy(() => import('./pages/public/PublicQuotePage'));

const publicFallback = (
  <div className="min-h-screen bg-gray-950 flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-gray-700 border-t-indigo-400 rounded-full animate-spin" />
  </div>
);

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { authReady, isAuthenticated, hasAccess } = useAuth();

  if (!authReady || !isAuthenticated || !hasAccess) return <AuthGate />;

  return (
    <OnboardingGate>
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </OnboardingGate>
  );
};


function App() {
  useEffect(() => {
    // Catch Gmail OAuth callback tokens from URL hash
    const hash = window.location.hash;
    if (hash.includes('gmail_access=') || hash.includes('gmail_error=')) {
      if (hash.includes('gmail_error=true')) {
        console.error('Gmail connection failed');
      } else {
        const params = new URLSearchParams(hash.slice(1));
        const accessToken = params.get('gmail_access');
        const refreshToken = params.get('gmail_refresh');
        const email = params.get('gmail_email');
        if (accessToken && refreshToken) {
          saveGmailTokens({ accessToken, refreshToken, email });
        }
      }
      // Clean the hash from the URL
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            <Route path="/p/:slug" element={<Suspense fallback={publicFallback}><PublicEnquiryPage /></Suspense>} />
            <Route path="/q/:token" element={<Suspense fallback={publicFallback}><PublicQuotePage /></Suspense>} />
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
