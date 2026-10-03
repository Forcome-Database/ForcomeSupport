/** 品牌标（原型 _brand）：渐变方块「F」+ Forcome + Support */
export function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2.25">
      <div className="flex size-7 items-center justify-center rounded-md bg-brand-gradient text-14 font-bold text-white shadow-pop">
        F
      </div>
      <div className="text-14 font-semibold tracking-[-0.01em] text-foreground">Forcome</div>
      <div className="-ml-0.75 text-13 whitespace-nowrap text-subtle-foreground">Support</div>
    </div>
  );
}
