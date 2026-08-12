import React, { useState } from 'react';
import { WalletsView } from '../views/WalletsView';
import { FundingView } from '../views/FundingView';
import { TradingView } from '../views/TradingView';
import { AutomationView } from '../views/AutomationView';
import { ActivityView } from '../views/ActivityView';
import { SettingsView } from '../views/SettingsView';
const tabs = ['Wallets', 'Funding', 'Trading', 'Automation', 'Activity', 'Settings'] as const;
type TabKey = (typeof tabs)[number];

const TabContent: Record<TabKey, () => React.ReactElement> = {
  Wallets: WalletsView,
  Funding: FundingView,
  Trading: TradingView,
  Automation: AutomationView,
  Activity: ActivityView,
  Settings: SettingsView,
};

export const AppTabs = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('Wallets');
  const ActiveComponent = TabContent[activeTab];

  return (
    <div className="tabs-container">
      <nav className="tabs-nav">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <section className="tabs-panel">
        <ActiveComponent />
      </section>
    </div>
  );
};
