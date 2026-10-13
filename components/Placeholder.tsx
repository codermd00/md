export default function Placeholder({ title, sub, stage }: { title: string; sub: string; stage: number }) {
  return (
    <>
      <div className="topbar"><div><div className="h1">{title}</div><div className="sub">{sub}</div></div></div>
      <div className="card empty">
        <b>Coming in stage {stage}</b>
        
      </div>
    </>
  );
}
