import { useState } from "react";

export default function Tabs({ tabs, initialKey }) {
    const [active, setActive] = useState(initialKey ?? tabs[0]?.key);

    return (
        <div className="tabs">
            <div className="tabs__list" role="tablist">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        role="tab"
                        className={`tabs__tab ${active === t.key ? "is-active" : ""}`}
                        onClick={() => setActive(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="tabs__panels">
                {tabs.map(t => (
                    <div
                        key={t.key}
                        role="tabpanel"
                        hidden={active !== t.key}
                        className="tabs__panel"
                    >
                        {t.content}
                    </div>
                ))}
            </div>
        </div>
    );
}
