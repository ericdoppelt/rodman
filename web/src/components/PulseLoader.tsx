// A tiny live ticker: five bars run the same dip/recover story — down = red
// (the "buy the dip"), up = green (the recovery), settle = grey — staggered
// left to right so it reads as one wave sweeping across, not five bars
// blinking in place. Reads as a chart, not a chart's clip-art. Always
// animates, regardless of Reduce Motion — deliberate, see docs/decisions.
export function PulseLoader() {
  return (
    <div className="pulse-loader" aria-label="Loading picks" role="status">
      <div className="pulse-bars">
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
        <span className="pulse-bar" />
      </div>
    </div>
  );
}
