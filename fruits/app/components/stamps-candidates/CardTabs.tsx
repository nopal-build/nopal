import type { ReactNode } from "react";
import { Link } from "react-router";
import "./cardTabs.css";

/**
 * Tabs that look like recipe cards in a box: the open card joins the box
 * below it, the others stand a little lower behind it. Each tab is a link
 * (`?tab=`), so the back button and a shared link land on the same card.
 * On a phone the row scrolls sideways rather than wrapping.
 */
export function CardTabs({
  tabs,
  active,
  label,
  children,
}: {
  tabs: { key: string; label: string; to: string }[];
  active: string;
  /** What the tabs are, for a screen reader ("Project"). */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="card-tabs">
      <nav className="card-tabs__row" aria-label={label}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            preventScrollReset
            className="card-tabs__tab"
            aria-current={tab.key === active ? "page" : undefined}
            data-tab={tab.key}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="card-tabs__box">{children}</div>
    </div>
  );
}
