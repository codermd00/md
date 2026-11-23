export default function Loading() {
  return (
    <>
      <div className="sk" style={{ height: 26, width: 160 }} />
      <div className="sk" style={{ height: 36, width: "60%", marginTop: 14 }} />
      <div className="skgrid">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="sk" style={{ height: 120 }} />)}
      </div>
    </>
  );
}
