import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AuthGate from '@/components/auth/AuthGate';
import { useEffect } from 'react';
import { saveGmailTokens } from '@/lib/gmailClient';

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
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
