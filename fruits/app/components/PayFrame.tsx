// The frame around a pay page (payments seed): logged in, the app's own
// layout; through an emailed link, the page on its own, since there's no
// session to build a nav from. Used by /pay/:chargeId and /pay/plan/:id.
import type { ReactNode } from "react";
import { AppLayout } from "./AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { sprinkles } from "stamps/sprinkles.css";

export function PayFrame({ loggedIn, children }: { loggedIn: boolean; children: ReactNode }) {
  const page = (
    <CenterContent maxWidth={560}>
      <Stack gap={5} className={sprinkles({ my: 8 })}>
        {children}
      </Stack>
    </CenterContent>
  );
  return loggedIn ? <AppLayout>{page}</AppLayout> : page;
}
