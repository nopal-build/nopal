import { getPlainText, NotionText } from "./NotionText";
import type {
  BlockObjectResponse,
  Heading1BlockObjectResponse,
  Heading2BlockObjectResponse,
  Heading3BlockObjectResponse,
  ParagraphBlockObjectResponse,
  BulletedListItemBlockObjectResponse,
  NumberedListItemBlockObjectResponse,
  // QuoteBlockObjectResponse,
  // ToDoBlockObjectResponse,
  // ToggleBlockObjectResponse,
  // TemplateBlockObjectResponse,
  // SyncedBlockBlockObjectResponse,
  // ChildPageBlockObjectResponse,
  // ChildDatabaseBlockObjectResponse,
  // EquationBlockObjectResponse,
  // CodeBlockObjectResponse,
  // CalloutBlockObjectResponse,
  // DividerBlockObjectResponse,
  // BreadcrumbBlockObjectResponse,
  // TableOfContentsBlockObjectResponse,
  ColumnListBlockObjectResponse,
  ColumnBlockObjectResponse,
  // LinkToPageBlockObjectResponse,
  // TableBlockObjectResponse,
  // TableRowBlockObjectResponse,
  // EmbedBlockObjectResponse,
  // BookmarkBlockObjectResponse,
  ImageBlockObjectResponse,
  VideoBlockObjectResponse,
  // PdfBlockObjectResponse,
  // FileBlockObjectResponse,
  // AudioBlockObjectResponse,
  // LinkPreviewBlockObjectResponse,
  // UnsupportedBlockObjectResponse
} from "@notionhq/client/build/src/api-endpoints";

export function NotionPageDetails({
  pageDetails,
}: {
  pageDetails: BlockObjectResponse[];
}) {
  return pageDetails
    ?.reduce(
      (
        acc: (BlockObjectResponse | NumberedListItemBlockObjectResponse[])[],
        detail
      ) => {
        if (detail.type == "numbered_list_item") {
          const lastIdx = acc.length - 1;
          const last = acc[lastIdx];
          if (Array.isArray(last)) {
            last.push(detail);
            return acc;
          } else {
            return [...acc, [detail]];
          }
        }
        return [...acc, detail];
      },
      []
    )
    .map((detail) => {
      if (Array.isArray(detail)) {
        const [firstDetail] = detail;
        if (firstDetail.type === "numbered_list_item") {
          return <NumberedListItems key={firstDetail.id} details={detail} />;
        }
        console.warn("Unsupported List Page Detail:", firstDetail.type);
        return null;
      }
      switch (detail.type) {
        case "heading_1":
          return <Heading1 key={detail.id} detail={detail} />;
        case "heading_2":
          return <Heading2 key={detail.id} detail={detail} />;
        case "heading_3":
          return <Heading3 key={detail.id} detail={detail} />;
        case "paragraph":
          return <Paragraph key={detail.id} detail={detail} />;
        case "bulleted_list_item":
          return <BulletedListItem key={detail.id} detail={detail} />;
        case "image":
          return <Image key={detail.id} detail={detail} />;
        case "video":
          return <Video key={detail.id} detail={detail} />;
        case "column_list":
          return <ColumnList key={detail.id} detail={detail} />;
        case "column":
          return <Column key={detail.id} detail={detail} />;
        default:
          console.warn("Unsupported Page Detail:", detail.type);
          console.log({ detail });
          return null;
      }
    });
}

function Heading1({ detail }: { detail: Heading1BlockObjectResponse }) {
  return (
    <h1 className="font-bold purple-light-text text-4xl mt-12">
      <NotionText text={detail.heading_1?.rich_text || []} />
    </h1>
  );
}

function Heading2({ detail }: { detail: Heading2BlockObjectResponse }) {
  return (
    <h2 className="font-bold green-text text-3xl mt-8">
      <NotionText text={detail.heading_2?.rich_text || []} />
    </h2>
  );
}

function Heading3({ detail }: { detail: Heading3BlockObjectResponse }) {
  return (
    <h3 className="font-bold green-text text-2xl mt-4">
      <NotionText text={detail.heading_3?.rich_text || []} />
    </h3>
  );
}

function Paragraph({ detail }: { detail: ParagraphBlockObjectResponse }) {
  return (
    <p className="text-xl mt-2">
      <NotionText text={detail.paragraph?.rich_text || []} />
    </p>
  );
}

function BulletedListItem({
  detail,
}: {
  detail: BulletedListItemBlockObjectResponse;
}) {
  return (
    <ul className="list-disc ml-4 text-xl mt-2">
      <li>
        <NotionText text={detail.bulleted_list_item?.rich_text || []} />
      </li>
    </ul>
  );
}

function NumberedListItems({
  details,
}: {
  details: NumberedListItemBlockObjectResponse[];
}) {
  return (
    <ol className="list-decimal ml-4 text-xl mt-2">
      {details.map((detail) => (
        <li key={detail.id}>
          <NotionText text={detail.numbered_list_item?.rich_text || []} />
        </li>
      ))}
    </ol>
  );
}

function Image({ detail }: { detail: ImageBlockObjectResponse }) {
  const image = detail.image;
  if (image.type !== "file") return null;

  const url = image?.file?.url;
  if (!url) return null;

  const caption = getPlainText(image.caption);

  return <img className="mt-4" src={url} alt={caption} />;
}

function Video({ detail }: { detail: VideoBlockObjectResponse }) {
  const video = detail.video;
  if (video.type !== "external") return null;

  const getUrl = () => {
    const url = video?.external?.url;

    // Route every YouTube embed through youtube-nocookie.com ("privacy-
    // enhanced mode"), which doesn't set YouTube's tracking/ads cookies
    // until the viewer presses play — so this page doesn't need a
    // cookie-consent banner just for an embedded video.
    // Input: https://youtu.be/Nk-I--FN2BU?si=CPMkK7KVMKtmfwUG
    // Output: https://www.youtube-nocookie.com/embed/Nk-I--FN2BU?si=dm8N4Mm-tbDKEZHY
    if (url.startsWith("https://youtu.be/")) {
      return url.replace(
        "https://youtu.be/",
        "https://www.youtube-nocookie.com/embed/",
      );
    }
    if (url.includes("youtube.com/embed/")) {
      return url.replace(
        /https:\/\/(www\.)?youtube\.com\/embed\//,
        "https://www.youtube-nocookie.com/embed/",
      );
    }

    return url;
  };

  const url = getUrl();
  if (!url) return null;

  const caption = getPlainText(video.caption);

  return (
    <div key={detail.id} className="video-container">
      <iframe
        width="600"
        height="315"
        src={url}
        title={caption || "YouTube video player"}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

function Column({ detail }: { detail: ColumnBlockObjectResponse }) {
  // @ts-ignore
  const children = detail.children.results;
  const widthRatio = detail.column.width_ratio;

  const getWidthClassName = () => {
    const baseClasses = "w-full";
    if (widthRatio == 0.5) {
      return `${baseClasses} sm:w-1/2`;
    }
    return "";
  };

  return (
    <div className={getWidthClassName()}>
      <NotionPageDetails pageDetails={children} />
    </div>
  );
}

function ColumnList({ detail }: { detail: ColumnListBlockObjectResponse }) {
  // @ts-ignore
  const columns: BlockObjectResponse[] = detail.children.results;

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <NotionPageDetails pageDetails={columns} />
    </div>
  );
}
