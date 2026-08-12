import { AppTabs } from './components/AppTabs';
import { HeaderBanner } from './components/HeaderBanner';
import { Toaster } from './components/Toaster';

export const App = () => {
  return (
    <div className="app-shell">
      <HeaderBanner message="" />
      <AppTabs />
      <Toaster />
    </div>
  );
};
