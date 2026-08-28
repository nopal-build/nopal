import { Layout } from "../components/Layout";
import goodsStyles from "../styles/goods.css?url";
import { LinksFunction } from "react-router";
import { FooterDiscovery } from "../components/Footer";
import { Carousel } from "../components/Carousel";
import { GoodContact, GoodButtonBuilding } from "../components/GoodAssets";
import { useArchCarouselHeight } from "../hooks/useArchCarouselHeight.client";
import { surfaceBase } from "stamps/surface.css";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: goodsStyles },
];

export default function GoodArchitecture() {
  const height = useArchCarouselHeight?.() || 0;
  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container mt-12 p-4">
          <h1 className="purple-light-text text-4xl">
            Good Design & Architecture
          </h1>
          <p className="text-xl mt-4">
            We collaborate to create truly good homes: combining art, high
            performance design, and the healthiest materials.
          </p>
        </div>
        <div className="arch-carousel">
          <Carousel
            height={height + "px"}
            slides={(setCurrent) => [
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-1.png"
                  alt="Home 1"
                  onClick={() => setCurrent(0)}
                />
                <ArchImg src="/good-architecture/arch-1.png" alt="Home 1" />
              </ArchSlide>,
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-2.png"
                  alt="Home 2"
                  onClick={() => setCurrent(1)}
                />
                <ArchImg src="/good-architecture/arch-2.png" alt="Home 2" />
              </ArchSlide>,
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-3.png"
                  alt="Home 3"
                  onClick={() => setCurrent(2)}
                />
                <ArchImg src="/good-architecture/arch-3.png" alt="Home 3" />
              </ArchSlide>,
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-4.png"
                  alt="Home 4"
                  onClick={() => setCurrent(3)}
                />
                <ArchImg src="/good-architecture/arch-4.png" alt="Home 4" />
              </ArchSlide>,
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-5.png"
                  alt="Home 5"
                  onClick={() => setCurrent(4)}
                />
                <ArchImg src="/good-architecture/arch-5.png" alt="Home 5" />
              </ArchSlide>,
              <ArchSlide>
                <ArchFiller
                  src="/good-architecture/filler-6.png"
                  alt="Home 6"
                  onClick={() => setCurrent(5)}
                />
                <ArchImg src="/good-architecture/arch-6.png" alt="Home 6" />
              </ArchSlide>,
              <div className="relative">
                <ArchSlide>
                  <ArchFiller
                    src="/good-architecture/filler-7.png"
                    alt="Home 7"
                    onClick={() => setCurrent(6)}
                  />
                  <ArchImg src="/good-architecture/arch-7.png" alt="Home 7" />
                </ArchSlide>
                <div className="last-slide">
                  <ArchFiller
                    src="/good-architecture/filler-8.png"
                    alt="Filler 8"
                    onClick={() => setCurrent(7)}
                  />
                </div>
              </div>,
            ]}
          />
        </div>

        <div className="simple-container mt-12 p-4">
          <h2 className="green-text text-3xl">Goodies</h2>
          <div className="flex sm:flex-row flex-col gap-4 mt-4">
            <div className={`${surfaceBase} p-4 font-mono basis-1/2`}>
              <h3 className="font-bold text-3xl">Restorations</h3>
              <div className="purple-light-text">For Remodels & Retrofits</div>
              <hr className="my-4" />
              <div className="font-bold text-3xl">$36k+</div>
              <div className="purple-light-text">Starting</div>
            </div>
            <div className={`${surfaceBase} p-4 font-mono basis-1/2`}>
              <h3 className="font-bold text-3xl">Creations</h3>
              <div className="purple-light-text">Custom Designs</div>
              <hr className="my-4" />
              <div className="font-bold text-3xl">$60k+</div>
              <div className="purple-light-text">Starting</div>
            </div>
          </div>
          <h3 className="mt-16 text-center purple-light-text font-bold text-2xl">
            What's Included
          </h3>
          <IncludedBox
            title="Health First"
            desc="From Physical to Mental, we explore how homes can improve your life."
          >
            {healthFirstSvg}
          </IncludedBox>
          <IncludedBox
            title="Good Materials"
            desc="We help you select materials that work towards your goals."
          >
            {goodMaterialsSvg}
          </IncludedBox>
          <IncludedBox
            title="Minimized Carbon"
            desc="Often times the best decisions are the least carbon impact."
          >
            {minimizedCarbonSvg}
          </IncludedBox>
          <IncludedBox
            title="Passive House"
            desc="A byproduct of creating healthy homes is high performance."
          >
            {passiveHouseSvg}
          </IncludedBox>
          <p className="text-lg mt-12">
            We would love to be the guide that helps you all down the path
            towards building your home.
          </p>

          <p className="text-lg italic purple-light-text mt-8">
            Hint: We can help build your home as well!
          </p>

          <GoodContact>
            <GoodButtonBuilding />
          </GoodContact>
        </div>
      </div>
      <FooterDiscovery />
    </Layout>
  );
}

function ArchSlide({ children }: { children: React.ReactNode }) {
  return <div className="arch-slide flex items-center">{children}</div>;
}

function ArchImg({ src, alt }: { src: string; alt: string }) {
  return <img className={"arch-img"} src={src} alt={alt} />;
}

function ArchFiller({
  src,
  alt,
  onClick,
}: {
  src: string;
  alt: string;
  onClick?: () => void;
}) {
  return (
    <img onClick={onClick} className={"arch-filler"} src={src} alt={alt} />
  );
}

function IncludedBox({
  children,
  title,
  desc,
}: {
  children: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="included-box">
      {children}
      <div>
        <h4 className="text-2xl font-bold">{title}</h4>
        <p className="text-lg mt-1">{desc}</p>
      </div>
    </div>
  );
}

const goodMaterialsSvg = (
  <svg
    width="50"
    height="62"
    viewBox="0 0 50 62"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M42.9395 60.9216V4.33605C42.9395 4.33605 46.451 4.07432 48.6794 4.33605C49.7903 25.2568 47.5684 36.813 48.6794 60.9216C46.451 61.1833 42.9395 60.9216 42.9395 60.9216Z"
      fill="#FFEAA4"
      stroke="#3F2B46"
    />
    <path
      d="M42.9395 4.33623V60.9218C42.9395 60.9218 39.4279 61.1835 37.1996 60.9218C36.0886 40.001 38.3105 28.4449 37.1996 4.33623C39.4279 4.07449 42.9395 4.33623 42.9395 4.33623Z"
      fill="#FFF9F1"
      stroke="#3F2B46"
    />
    <path
      d="M24 1L37.0682 4.40909H42.75L30.25 1.37879L24 1Z"
      fill="#FFF9F1"
      stroke="#3F2B46"
    />
    <path
      d="M30.0605 1.37891L43.1287 4.40921H48.8105L36.3105 1.37891H30.0605Z"
      fill="#FFEAA4"
      stroke="#3F2B46"
    />
    <path
      d="M24.7576 56.8712L24.1895 1.09473C24.1895 1.09473 32.2387 2.98867 37.1629 4.59851C38.1099 11.1326 37.3523 60.9432 37.3523 60.9432L24.7576 56.8712Z"
      fill="#FFF9F1"
      stroke="#3F2B46"
    />
    <path
      d="M7.68365 41.9745C5.45576 39.8952 1 33.865 1 26.3793C1 17.0222 3.89625 13.6804 7.68365 13.6804C10.1714 13.3462 15.4812 12.9229 16.818 13.0121C18.4889 13.1234 25.8409 18.5818 25.8409 29.2756C25.8409 37.1325 22.2706 40.7051 20.0484 41.7536L33.5271 48.4355C32.6359 49.2153 31.8056 49.3579 30.6308 49.7722C29.4468 50.1898 28.6367 49.9942 27.5118 50.552C26.6465 50.9811 25.85 51.6781 25.5067 52L11.2483 43.9796L9.67416 43.0942C9.06422 42.8501 8.40219 42.4828 7.68365 41.9745Z"
      fill="#6D6E99"
    />
    <path
      d="M7.68365 41.9745C5.45576 39.8952 1 33.865 1 26.3793C1 17.0222 3.89625 13.6804 7.68365 13.6804M7.68365 41.9745C16.818 48.4354 16.818 32.1273 16.818 29.2756C16.818 25.711 12.1394 13.6804 7.68365 13.6804M7.68365 41.9745L11.2483 43.9796M7.68365 13.6804C10.1714 13.3462 15.4812 12.9229 16.818 13.0121C18.4889 13.1234 25.8409 18.5818 25.8409 29.2756C25.8409 37.1325 22.2706 40.7051 20.0484 41.7536M11.2483 43.9796L25.5067 52C25.85 51.6781 26.6465 50.9811 27.5118 50.552C28.6367 49.9942 29.4468 50.1898 30.6308 49.7722C31.8056 49.3579 32.6359 49.2153 33.5271 48.4355L20.0484 41.7536M11.2483 43.9796L19.4914 41.9745C19.6641 41.92 19.8509 41.8467 20.0484 41.7536"
      stroke="#3F2B46"
    />
    <path
      d="M10.8032 43.7567L25.73 51.9998C26.0734 51.678 26.8698 50.9809 27.7351 50.5518C28.86 49.9941 29.6701 50.1897 30.8542 49.7721C32.0289 49.3577 32.8592 49.2151 33.7504 48.4353L20.2717 41.7534C20.0743 41.8466 19.8875 41.9198 19.7147 41.9744L10.8032 43.7567Z"
      fill="#8D8EB4"
      stroke="#3F2B46"
    />
    <path
      d="M7.68364 41.9748C5.45576 39.8954 1 33.8653 1 26.3796C1 17.0225 3.89625 13.6807 7.68364 13.6807C12.1394 13.6807 16.818 25.7112 16.818 29.2758C16.818 31.9032 16.818 45.9531 9.67417 43.0944C9.06422 42.8504 8.4022 42.483 7.68364 41.9748Z"
      fill="#3F2B46"
    />
    <path
      d="M7.68364 41.9748C5.45576 39.8954 1 33.8653 1 26.3796C1 17.0225 3.89625 13.6807 7.68364 13.6807C12.1394 13.6807 16.818 25.7112 16.818 29.2758C16.818 32.1275 16.818 48.4356 7.68364 41.9748ZM7.68364 41.9748L11.2483 43.9799"
      stroke="#3F2B46"
    />
    <path
      d="M9.4039 22.9007C10.3874 23.8551 12.3359 26.6031 12.2624 29.9598C12.1705 34.1558 10.8327 35.6257 9.12607 35.5883C7.11832 35.5444 5.12832 30.1035 5.16332 28.505C5.18912 27.3268 5.32708 21.0265 8.51798 22.3789C8.79042 22.4944 9.08512 22.6657 9.4039 22.9007Z"
      fill="#8D8EB4"
    />
    <path
      d="M9.4039 22.9007C10.3874 23.8551 12.3359 26.6031 12.2624 29.9598C12.1705 34.1558 10.8327 35.6257 9.12607 35.5883C7.11832 35.5444 5.12832 30.1035 5.16332 28.505C5.19132 27.2262 5.35146 19.9133 9.4039 22.9007ZM9.4039 22.9007L7.81739 21.9664"
      stroke="#3F2B46"
    />
  </svg>
);

const healthFirstSvg = (
  <svg
    width="48"
    height="37"
    viewBox="0 0 48 37"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M36.6568 1.04337C30.3666 0.269222 23.3195 10.1161 23.3195 10.1161C23.3195 10.1161 17.8214 1.02165 12.1598 1.04337C5.53011 1.06879 1.00001 7.08554 1 13.5851C0.999991 24.2589 23.3195 36 23.3195 36C23.3195 36 47 26.6605 47 13.5851C47 7.22061 43.0982 1.83611 36.6568 1.04337Z"
      fill="#F6C8C3"
      stroke="#A63B31"
    />
  </svg>
);

const minimizedCarbonSvg = (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="23.2725"
      y="7.34717"
      width="1.45455"
      height="32.3267"
      fill="#6D6E99"
    />
    <rect
      x="40"
      y="23.5107"
      width="1.46939"
      height="32"
      transform="rotate(90 40 23.5107)"
      fill="#6D6E99"
    />
    <circle cx="24.0002" cy="24.2448" r="8.04073" fill="#494A72" />
    <ellipse
      cx="24.0001"
      cy="6.12248"
      rx="6.06061"
      ry="6.12248"
      fill="#8D8EB4"
    />
    <ellipse
      cx="41.9395"
      cy="24.245"
      rx="6.06061"
      ry="6.12248"
      fill="#8D8EB4"
    />
    <ellipse
      cx="6.06061"
      cy="24.245"
      rx="6.06061"
      ry="6.12248"
      fill="#8D8EB4"
    />
    <ellipse
      cx="24.0001"
      cy="41.8774"
      rx="6.06061"
      ry="6.12248"
      fill="#8D8EB4"
    />
  </svg>
);

const passiveHouseSvg = (
  <svg
    width="52"
    height="45"
    viewBox="0 0 52 45"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M2.61606 31.1614C2.61606 34.3427 2.01355 41.2032 2.01355 43.3321C7.79763 43.3321 16.1038 43.2118 22.6193 42.7296C25.9192 42.4853 41.0159 43.5329 48.7682 43.3321C49.0494 42.7296 48.9128 41.2594 49.0092 40.199C49.1297 38.8735 49.1297 24.293 49.7322 21.2805C50.3347 18.268 49.7322 17.5447 49.7322 15.6167C49.0092 15.0142 44.7916 12.9657 43.9481 12.4836C43.1046 12.0016 37.8829 8.97024 36.236 7.90458C32.139 5.25355 28.8854 3.48619 25.8729 2C22.6193 3.60669 18.2813 6.33806 15.5097 7.90458C14.4297 8.51505 4.42358 13.4477 2.01355 15.6167C1.89305 18.1472 2.61606 27.1849 2.61606 31.1614Z"
      fill="#8D8EB4"
      stroke="#3F2B46"
      strokeWidth="3"
    />
  </svg>
);
