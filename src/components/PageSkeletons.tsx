// Loading placeholders shaped like each page: the same
// cards in the same grid as the loaded page, so nothing jumps when the data lands.
// Card heights are measured from the loaded pages with Playwright at 390 and 1440 wide and
// fixed here: `h` is a Tailwind height,
// phone first, `sm:` for tablet and desktop. The bars inside are clipped to that box, so
// they can never change its size. Re-measure when a page's layout changes.
import { SkeletonBar } from '@/components/Card';

function Page({ children, className = 'space-y-[var(--page-gap)]' }: { children: React.ReactNode; className?: string }) {
  return <div className={`skeleton ${className}`} aria-busy="true" aria-label="Loading">{children}</div>;
}

// A card of fixed height; the body takes what is left under the head and clips.
function Box({ h, tile = false, className = '', children }: { h: string; tile?: boolean; className?: string; children: React.ReactNode }) {
  const pad = tile ? 'p-4 max-sm:px-3 max-sm:py-3' : 'p-3.5 sm:p-4 lg:p-5';
  return <div className={`card flex flex-col overflow-hidden ${pad} ${h} ${className}`}>{children}</div>;
}

// Eyebrow, value, context line; `lines` adds rows of small figures (device and country tiles).
function Tile({ h, lines = 0, className = '' }: { h: string; lines?: number; className?: string }) {
  return (
    <Box h={h} tile className={className}>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
        <SkeletonBar width="55%" height="0.7rem" />
        <SkeletonBar width="75%" height="1.75rem" />
        <SkeletonBar width="45%" height="0.7rem" />
        {lines > 0 && (
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
            {Array.from({ length: lines * 3 }).map((_, i) => <SkeletonBar key={i} width="80%" height="0.7rem" />)}
          </div>
        )}
      </div>
    </Box>
  );
}

// Title, and a subtitle line when the loaded card has one.
function CardHead({ sub = false }: { sub?: boolean }) {
  return (
    <div className="mb-3 shrink-0 space-y-2 sm:mb-4">
      <SkeletonBar width="9rem" height="1rem" />
      {sub && <SkeletonBar width="16rem" height="0.7rem" className="max-w-full" />}
    </div>
  );
}

function ChartCard({ h, sub = false, className = '' }: { h: string; sub?: boolean; className?: string }) {
  return (
    <Box h={h} className={className}>
      <CardHead sub={sub} />
      <div className="skeleton-bar min-h-0 w-full flex-1" />
    </Box>
  );
}

const NAME_WIDTHS = ['62%', '48%', '70%', '55%', '40%', '66%', '52%', '58%'];

// Rows are 40px like table.data on desktop; extra rows are clipped by the card.
function TableCard({ h, sub = false, rows = 30, className = '' }: { h: string; sub?: boolean; rows?: number; className?: string }) {
  return (
    <Box h={h} className={className}>
      <CardHead sub={sub} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-10 items-center justify-between border-b border-line">
          <SkeletonBar width="5rem" height="0.65rem" />
          <div className="flex gap-6"><SkeletonBar width="3rem" height="0.65rem" /><SkeletonBar width="3rem" height="0.65rem" /><SkeletonBar width="3rem" height="0.65rem" className="max-sm:hidden" /></div>
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex h-10 items-center justify-between gap-6 border-b" style={{ borderColor: 'var(--gray-200)' }}>
            <SkeletonBar width={NAME_WIDTHS[i % NAME_WIDTHS.length]} height="0.8rem" className="max-w-[16rem]" />
            <div className="flex shrink-0 gap-6"><SkeletonBar width="3rem" height="0.8rem" /><SkeletonBar width="3rem" height="0.8rem" /><SkeletonBar width="3rem" height="0.8rem" className="max-sm:hidden" /></div>
          </div>
        ))}
      </div>
    </Box>
  );
}

// A short card of text lines (notes, notices).
function TextCard({ h, lines = 1 }: { h: string; lines?: number }) {
  return (
    <Box h={h}>
      <CardHead />
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
        {Array.from({ length: lines }).map((_, i) => <SkeletonBar key={i} width={i === lines - 1 ? '60%' : '95%'} height="0.75rem" />)}
      </div>
    </Box>
  );
}

function GoalCard({ h }: { h: string }) {
  return (
    <Box h={h} tile>
      <div className="flex justify-between"><SkeletonBar width="7rem" height="0.7rem" /><SkeletonBar width="10rem" height="0.7rem" /></div>
      <div className="mx-auto mt-6 flex h-[124px] w-[198px] shrink-0 items-end justify-center"><div className="skeleton-arc" /></div>
      <div className="mt-3 flex justify-center"><SkeletonBar width="14rem" height="0.7rem" className="max-w-full" /></div>
      <div className="mt-auto border-t pt-3" style={{ borderColor: 'var(--gray-200)' }}><SkeletonBar width="60%" height="0.7rem" /></div>
    </Box>
  );
}

const repeat = (count: number, render: (i: number) => React.ReactNode) => Array.from({ length: count }).map((_, i) => render(i));

export function OverviewSkeleton({ goals }: { goals: boolean }) {
  return (
    <Page>
      {goals && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <GoalCard h="h-[362px] sm:h-[314px]" />
          <GoalCard h="h-[334px] sm:h-[314px]" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{repeat(12, i => <Tile key={i} h="h-[98.4px] sm:h-[115px]" />)}</div>
      <TableCard h="h-[398px] sm:h-[374px]" />
      <TableCard h="h-[495px] sm:h-[506px]" sub />
      <TableCard h="h-[955px] sm:h-[804px]" />
    </Page>
  );
}

// One table per network group (Branded, Non-Branded Search, Non-Branded Shopping, Display).
export function CampaignsSkeleton() {
  return (
    <Page>
      <TableCard h="h-[271px] sm:h-[253px]" />
      <TableCard h="h-[612px] sm:h-[454px]" />
      <TableCard h="h-[798px] sm:h-[615px]" />
      <TableCard h="h-[234px] sm:h-[213px]" />
    </Page>
  );
}

// Total, Search, Shopping, Shopping per bucket.
export function CategoriesSkeleton() {
  return (
    <Page>
      <TableCard h="h-[531px] sm:h-[494px]" />
      <TableCard h="h-[421px] sm:h-[374px]" />
      <TableCard h="h-[457px] sm:h-[414px]" />
      <TableCard h="h-[1644px] sm:h-[479px]" sub />
    </Page>
  );
}

// Buckets, Bucket trend, Label stability, What a switch does, Transitions.
export function BucketsSkeleton() {
  return (
    <Page>
      <TableCard h="h-[499px] sm:h-[251px]" sub />
      <ChartCard h="h-[388px] sm:h-[392px]" />
      <TableCard h="h-[1102px] sm:h-[781px]" />
      <TableCard h="h-[431px] sm:h-[448px]" />
      <TableCard h="h-[2015px] sm:h-[1648px]" sub />
    </Page>
  );
}

export function ProductsSkeleton() {
  return (
    <Page>
      <TableCard h="h-[2085px] sm:h-[1671px]" sub rows={45} />
      <TableCard h="h-[365px] sm:h-[386px]" sub />
    </Page>
  );
}

// The metric chips stay live above it, so this is the chart and the two tables under it.
export function TrendsSkeleton() {
  return (
    <Page>
      <ChartCard h="h-[487px] sm:h-[524px]" />
      <div className="grid grid-cols-1 gap-[var(--page-gap)] xl:grid-cols-2">
        <TableCard h="h-[590px] sm:h-[558px]" />
        <TableCard h="h-[477px] sm:h-[558px]" sub />
      </div>
    </Page>
  );
}

export function CountriesSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{repeat(2, i => <Tile key={i} h="h-[257px] sm:h-[189px]" lines={2} />)}</div>
        <SkeletonBar width="18rem" height="1.25rem" className="max-w-full" />
      </div>
      <ChartCard h="h-[410px] sm:h-[444px]" sub />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TableCard h="h-[631px] sm:h-[638px]" sub />
        <TableCard h="h-[441px] sm:h-[638px]" sub />
      </div>
      <TextCard h="h-[126px] sm:h-[94px]" />
    </Page>
  );
}

export function DevicesSkeleton() {
  return (
    <Page>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{repeat(4, i => <Tile key={i} h="h-[302px] sm:h-[355px]" lines={4} />)}</div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <ChartCard className="xl:col-span-3" h="h-[308px] sm:h-[384px]" sub />
        <ChartCard className="xl:col-span-2" h="h-[286px] sm:h-[384px]" />
      </div>
      <div className="grid grid-cols-1 gap-4">
        <TableCard h="h-[643px] sm:h-[636px]" sub />
        <TableCard h="h-[447px] sm:h-[471px]" sub />
      </div>
    </Page>
  );
}

// Network and category chips above the cards, then chart, competitors and new players.
export function AuctionSkeleton() {
  return (
    <Page>
      <div className="flex h-[172px] flex-wrap content-start gap-1.5 sm:h-[34px]">
        {[150, 120, 160, 140, 130].map((w, i) => <SkeletonBar key={i} width={`${w}px`} height="2.125rem" className="!rounded-lg" />)}
      </div>
      <ChartCard h="h-[520px] sm:h-[474px]" sub />
      <TableCard h="h-[829px] sm:h-[709px]" sub />
      <TextCard h="h-[124px] sm:h-[140px]" />
    </Page>
  );
}

// The admin-only audit card at the bottom is left out: clients never see it.
export function FeedSkeleton() {
  return (
    <Page>
      <div className="space-y-[var(--page-gap)]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{repeat(4, i => <Tile key={i} h="h-[126px] sm:h-[115px]" />)}</div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TextCard h="h-[148px] sm:h-[224px]" lines={2} />
          <TableCard h="h-[217px] sm:h-[224px]" sub />
        </div>
      </div>
      <TableCard h="h-[489px] sm:h-[427px]" sub />
      <TableCard h="h-[2352px] sm:h-[1949px]" sub rows={60} />
    </Page>
  );
}

export function MeetingsSkeleton() {
  return (
    <Page>
      <div className="h-[76px] sm:h-5"><SkeletonBar width="22rem" height="1.25rem" className="max-w-full" /></div>
      <TableCard h="h-[1759px] sm:h-[753px]" sub rows={45} />
      <TableCard h="h-[4863px] sm:h-[2143px]" sub rows={60} />
    </Page>
  );
}

export function TreeSkeleton() {
  return <Page><ChartCard h="h-[2371px] sm:h-[1565px]" /></Page>;
}

export function QualitySkeleton() {
  return (
    <Page>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile h="h-[110px] sm:h-[115px]" className="max-sm:col-span-2" />
        <Tile h="h-[144px] sm:h-[115px]" />
        <Tile h="h-[144px] sm:h-[115px]" />
      </div>
      <div className="grid gap-[var(--page-gap)] lg:grid-cols-2">
        <ChartCard h="h-[334px] sm:h-[398px]" sub />
        <ChartCard h="h-[328px] sm:h-[398px]" sub />
      </div>
      <TableCard h="h-[462px] sm:h-[268px]" sub />
      <TableCard h="h-[876px] sm:h-[747px]" sub />
      <TableCard h="h-[1079px] sm:h-[1028px]" sub />
      <TableCard h="h-[1727px] sm:h-[1610px]" sub rows={45} />
    </Page>
  );
}

export function StatusSkeleton() {
  return (
    <Page className="space-y-6">
      <TableCard h="h-[1100px] sm:h-[1068px]" sub />
      <TableCard h="h-[1450px] sm:h-[1510px]" sub rows={40} />
      <TextCard h="h-[128px] sm:h-[124px]" />
    </Page>
  );
}
