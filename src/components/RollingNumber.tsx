// A formatted value whose digits roll to the new value like an odometer when the
// period, account or filter changes. Columns are
// keyed from the right, so "999" to "1.000" keeps the ones, tens and hundreds
// rolling and only the new column appears. Currency signs, separators, "x" and "%"
// stay plain text. The first render shows the value as is; only changes roll.
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function RollingNumber({ text }: { text: string }) {
  const chars = Array.from(text);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="roll" aria-hidden>
        {chars.map((ch, i) => {
          const fromRight = chars.length - 1 - i;
          if (ch < '0' || ch > '9') return <span key={`c${fromRight}`} className="roll-char">{ch}</span>;
          return (
            <span key={`d${fromRight}`} className="roll-col">
              <span className="roll-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)`, transitionDelay: `${fromRight * 35}ms` }}>
                {DIGITS.map(d => <span key={d}>{d}</span>)}
              </span>
            </span>
          );
        })}
      </span>
    </>
  );
}
