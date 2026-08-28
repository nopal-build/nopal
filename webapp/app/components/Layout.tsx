import { Link, NavLink } from "react-router";
import nopalLogo from "../images/nopal-v2.svg";
import nopalDarkLogo from "../images/nopal-dark-v2.svg";
import sun from "../images/sun.svg";
import moon from "../images/moon.svg";
import {
  ReactNode,
  useRef,
  useState,
  useCallback,
  SyntheticEvent,
} from "react";
import { useSchemePref } from "../hooks/useSchemePref";
import { useClickOutside } from "../hooks/useClickOutside";
import {
  GoodBuildingLink,
  GoodGuidingLink,
  GoodArchitectureLink,
} from "./GoodAssets";

export function Layout({ children }: { children?: ReactNode }) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";

  const ref = useRef<HTMLDivElement>(null);
  const goodsRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [showGoods, setShowGoods] = useState(false);

  const onMenuClick = useCallback(
    (e: SyntheticEvent) => {
      e?.preventDefault();
      setExpanded(!expanded);
    },
    [expanded]
  );
  useClickOutside(ref, () => {
    setExpanded(false);
    setShowGoods(false);
  });

  const handleGoods = useCallback(
    (e: SyntheticEvent<HTMLElement>) => {
      if (e.currentTarget?.classList.contains("active")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!expanded) {
        e.preventDefault();
        setShowGoods(!showGoods);
      }
    },
    [showGoods, expanded]
  );
  const handleGoodItemClick = useCallback(() => {
    setExpanded(false);
    setShowGoods(false);
  }, []);
  useClickOutside(goodsRef, handleGoodItemClick);

  return (
    <div className="page-wrapper">
      <div className="header container mx-auto pl-4 pr-4">
        <div className="py-4 flex justify-between items-center">
          <h1 className="text-6xl text-center">
            <Link to="/" prefetch="intent">
              <img src={isDark ? nopalDarkLogo : nopalLogo} alt="nopal" />
            </Link>
          </h1>
          <a href="#" onClick={onMenuClick} className="hamburger-menu">
            Menu
            <div className="menu-bars">
              <div />
              <div />
              <div />
            </div>
          </a>
          <nav
            ref={ref}
            className="main-nav mr-4 ml-4"
            style={expanded ? { display: "block" } : {}}
          >
            <NavLink
              to="/health"
              prefetch="intent"
              className="main-nav-item p-2"
            >
              Health
            </NavLink>
            <div className="good-menu" tabIndex={0}>
              <NavLink
                to="/good/s"
                prefetch="intent"
                onClick={handleGoods}
                className="main-nav-item p-2"
              >
                Goods
              </NavLink>
              <div
                ref={goodsRef}
                className="good-menu-container"
                style={{ display: !expanded && showGoods ? "flex" : "none" }}
              >
                <svg
                  width="26"
                  height="41"
                  viewBox="0 0 26 41"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M25.037 3.03273L18.6264 1.24645C16.8861 0.761518 15.4457 2.64986 16.3734 4.2001L19.6704 9.7093C20.5728 11.2171 22.8415 10.9118 23.3132 9.2191L25.037 3.03273ZM25.037 3.03273C25.037 3.03273 18.0743 6.98056 11.9302 10.4473C-2.00475 18.3088 0.718254 37.3844 2.19191 39.9976"
                    stroke="#7F5B8B"
                  />
                </svg>
                <ul>
                  <li>
                    <GoodArchitectureLink onClick={handleGoodItemClick} />
                  </li>
                  <li>
                    <GoodBuildingLink onClick={handleGoodItemClick} />
                  </li>
                  <li>
                    <GoodGuidingLink onClick={handleGoodItemClick} />
                  </li>
                </ul>
              </div>
            </div>
            <NavLink
              to="/sunny-home-no1"
              prefetch="intent"
              className="main-nav-item p-2 text-nowrap"
            >
              Sunny Home
            </NavLink>
            <NavLink
              to="/about"
              prefetch="intent"
              className="main-nav-item p-2 text-nowrap"
            >
              Collective
            </NavLink>
          </nav>
          {isDark ? (
            <img className="moon" src={moon} alt="moon" />
          ) : (
            <img className="sun" src={sun} alt="sun" />
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
