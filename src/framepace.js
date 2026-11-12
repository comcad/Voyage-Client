/**
 * Frame pacing (a Voyage matter: the original client runs on its own clock, not a browser's frames). A browser's
 * frame times wobble by a few ms around the display's refresh even when it draws every refresh: Safari stamps a frame
 * when its turn on the page's thread comes, after whatever ran just before it, but what is drawn still reaches the
 * screen on the refresh. Moving the game by those times steps it unevenly: a 20ms frame then a 13ms one moves
 * everything a fifth too far, then a fifth too short, and with the camera following you the whole screen shimmies.
 * So a frame within 0.4 of a refresh of a whole number of refreshes counts as exactly that many. What that rounds
 * off is kept, and only once it passes a few ms is it paid back, half a ms a frame, so the game keeps to the clock
 * without the wobble showing.
 *
 * The refresh is told from the frames themselves, so for a moment after the frame rate changes (out of a crowded
 * map, say) it is the old one, and frames that are no whole number of it get rounded the same way every time. Paid
 * back at half a ms a frame the game would run up to half as fast again until the refresh was right. So whatever
 * is owed past SLACK + FAR is paid at once: the game is never more than that far from the clock, whatever the
 * frames do.
 */
const SAMPLES = 240, SNAP = 0.4, SLACK = 4, PAY = 0.5, FAR = 8, LONG = 250, HALVES = 0.15;
export class FramePace {
  constructor() {
    this.gaps = []; this.lastOffer = null; this.offers = 0;
    this.refresh = 1000 / 60;   // the display's refresh (ms), until enough frames have come to tell
    this.owed = 0;              // ms the game is behind the clock (ahead when below 0)
  }
  /**
   * The browser offered a frame at t, drawn or not. The display's refresh: the average gap between offers over the
   * last few seconds, leaving out those a quarter off the median (missed refreshes, pauses). Each stamp's lateness
   * lengthens one gap and shortens the next, so over many gaps it cancels out. A page that makes some refreshes and
   * misses others has gaps of one refresh and of two: the refresh is the shorter, even when most are the longer
   * (which is also what tells soonest that a busy spell is over).
   */
  offer(t) {
    if (this.lastOffer !== null) {
      const g = t - this.lastOffer;
      if (g > 2 && g < 100) { this.gaps.push(g); if (this.gaps.length > SAMPLES) this.gaps.shift(); }
      if (++this.offers % 30 === 0 && this.gaps.length >= 30) {
        const s = [...this.gaps].sort((a, b) => a - b);
        let m = s[s.length >> 1], half = 0, sum = 0, n = 0;
        for (const v of s) if (v > m * 0.375 && v < m * 0.625) half++;
        if (half >= s.length * HALVES) m /= 2;
        for (const v of this.gaps) if (v > m * 0.75 && v < m * 1.25) { sum += v; n++; }
        this.refresh = n ? sum / n : m;
      }
    }
    this.lastOffer = t;
  }
  /** How many ms to move the game for a frame drawn `ms` after the one before. */
  step(ms) {
    if (!(ms > 0) || ms > LONG) { this.owed = 0; return Math.max(0, ms || 0); }   // a pause: nothing to even out
    const r = this.refresh, n = Math.round(ms / r);
    let use = n >= 1 && Math.abs(ms - n * r) <= r * SNAP ? n * r : ms;
    this.owed += ms - use;
    const over = Math.abs(this.owed) - SLACK;
    if (over > 0) {
      const pay = Math.max(-use, Math.sign(this.owed) * Math.min(over, Math.max(PAY, over - FAR)));
      use += pay; this.owed -= pay;
    }
    return use;
  }
}
