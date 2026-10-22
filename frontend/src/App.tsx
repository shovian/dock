import { lazy, Suspense, useState, useEffect } from 'react';
import { useApolloClient, useQuery, useMutation } from '@apollo/client';
import { Loader2 } from 'lucide-react';
import { GET_AUTH_STATUS } from './graphql/queries';
import { VERIFY_MASTER_PIN } from './graphql/mutations';
import { AppLayout } from './components/AppLayout';
import DashboardPage from './pages/DashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';
import NeedsAttentionPage from './pages/NeedsAttentionPage';
import BugReportsPage from './pages/BugReportsPage';
import SettingsPage from './pages/SettingsPage';
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import MonitoringPage from './pages/MonitoringPage';
import DockerServicesPage from './pages/DockerServicesPage';
import DemoVideosPage from './pages/DemoVideosPage';
import DevServersPage from './pages/DevServersPage';
import SessionsPage from './pages/SessionsPage';
import SprintPage from './pages/SprintPage';
import { PageBoundary } from './components/PageBoundary';
import { PinLockModal } from './components/PinLockModal';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { Button, Page } from './components/ui';
import { DockModeContext, hasPage, type DockMode } from './lib/dockMode';
import { BoardModeContext } from './lib/boardMode';

const AgentsPage = lazy(() => import('./pages/AgentsPage'));

function App() {
  const client = useApolloClient();
  const { data: live, error, refetch } = useQuery(GET_AUTH_STATUS, { fetchPolicy: 'network-only' });
  // The server cannot be reached: carry on with what this device saw last instead of stopping at a retry screen.
  const unreachable = Boolean(error?.networkError);
  const data = live ?? (unreachable ? client.readQuery({ query: GET_AUTH_STATUS }) : undefined);

  // Back in the foreground or back on a network: ask again without waiting for a tap.
  useEffect(() => {
    if (!unreachable) return undefined;
    const retry = () => { if (document.visibilityState === 'visible') void refetch(); };
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('online', retry);
    return () => {
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('online', retry);
    };
  }, [unreachable, refetch]);
  const [verifyMasterPin] = useMutation(VERIFY_MASTER_PIN);

  const getInitialRoute = () => {
    const path = window.location.pathname;
    if (path.startsWith('/detail/') || path.startsWith('/ticket/')) {
      const key = decodeURIComponent(path.split('/').pop() || '');
      return { path: '/ticket', key: key || null };
    }
    if (path === '/dashboard' || path === '/agents' || path === '/sessions' || path === '/calendar' || path === '/sprint' || path === '/monitoring' || path === '/docker' || path === '/demo-videos' || path === '/dev-servers' || path === '/attention' || path === '/bugs' || path === '/settings') {
      return { path, key: null };
    }
    return { path: '/', key: null };
  };

  const initialRoute = getInitialRoute();
  const [currentPath, setCurrentPath] = useState(initialRoute.path);
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(initialRoute.key);

  useEffect(() => {
    const handlePopState = () => {
      const route = getInitialRoute();
      setCurrentPath(route.path);
      setSelectedTicketKey(route.key);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleUnlock = async (pin: string): Promise<boolean> => {
    try {
      const res = await verifyMasterPin({ variables: { pin } });
      if (res.data?.verifyMasterPin) {
        await refetch();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleNavigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    if (path !== '/ticket') {
      setSelectedTicketKey(null);
    }
  };

  const navigateToTicket = (key: string) => {
    window.history.pushState({}, '', `/detail/${encodeURIComponent(key)}`);
    setSelectedTicketKey(key);
    setCurrentPath('/ticket');
  };

  const mode: DockMode = data?.dockMode === 'workspace' ? 'workspace' : 'laptop';
  // A page this DOCK leaves out, such as an old bookmark, opens Home.
  // The Bug Reports page exists only in board mode.
  const path = hasPage(mode, currentPath) && (currentPath !== '/bugs' || data?.boardMode === true) ? currentPath : '/';

  const renderPage = () => {
    switch (path) {
      case '/': return <HomePage onTicketClick={navigateToTicket} onNavigate={handleNavigate} />;
      case '/dashboard': return <DashboardPage onTicketClick={navigateToTicket} />;
      case '/agents': return <Suspense fallback={<Page width="full"><LoadingSkeleton /></Page>}><AgentsPage onTicketClick={navigateToTicket} onNavigate={handleNavigate} /></Suspense>;
      case '/sessions': return <SessionsPage onTicketClick={navigateToTicket} />;
      case '/calendar': return <CalendarPage onNavigate={handleNavigate} />;
      case '/sprint': return <SprintPage />;
      case '/monitoring': return <MonitoringPage onNavigate={handleNavigate} />;
      case '/docker': return <DockerServicesPage />;
      case '/demo-videos': return <DemoVideosPage onTicketClick={navigateToTicket} />;
      case '/dev-servers': return <DevServersPage />;
      case '/attention': return <NeedsAttentionPage onTicketClick={navigateToTicket} />;
      case '/bugs': return <BugReportsPage />;
      case '/settings': return <SettingsPage />;
      case '/ticket': return selectedTicketKey ? <TicketDetailPage ticketKey={selectedTicketKey} onBack={() => handleNavigate('/dashboard')} /> : <DashboardPage onTicketClick={navigateToTicket} />;
      default: return <HomePage onTicketClick={navigateToTicket} onNavigate={handleNavigate} />;
    }
  };

  if (!data?.authStatus) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
          <img src="/dock-logo.svg" alt="DOCK" className="size-14" />
          {error ? (
            <>
              <p className="text-sm text-secondary-foreground">Unable to restore your DOCK session.</p>
              <Button onClick={() => void refetch()}>
                Retry
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
              <p className="text-sm text-secondary-foreground">Restoring your session...</p>
            </>
          )}
        </div>
      </main>
    );
  }

  const isLocked = data.authStatus.hasMasterPin && !data.authStatus.authenticated;

  return (
    <DockModeContext.Provider value={mode}>
    <BoardModeContext.Provider value={data?.boardMode === true}>
      <AppLayout currentPath={path === '/ticket' ? '/dashboard' : path} onNavigate={handleNavigate} unreachable={unreachable} onRetry={() => void refetch()}>
        {!isLocked && <PageBoundary key={path}>{renderPage()}</PageBoundary>}
        <PinLockModal
          isOpen={isLocked}
          onUnlock={handleUnlock}
        />
      </AppLayout>
    </BoardModeContext.Provider>
    </DockModeContext.Provider>
  );
}

export default App;
