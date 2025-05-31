// Cache controls
const rainSpeedSlider = document.getElementById('rainSpeedSlider');
const rainSpeedValue  = document.getElementById('rainSpeedValue');
const rectSpeedSlider = document.getElementById('rectSpeedSlider');
const rectSpeedValue  = document.getElementById('rectSpeedValue');
const rectAngleSlider = document.getElementById('rectAngleSlider');
const rectAngleValue  = document.getElementById('rectAngleValue');

// Setup canvas
const canvas = document.getElementById('canvas2');
const ctx = canvas.getContext('2d');
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let lastTs = performance.now();

window.addEventListener('focus', () => {
  lastTs = performance.now();
  console.log( "Refocused" );
} );

const STATS_DURATION = 5;

let hitHistory = [];
let movementHistory = [];
let frameTimeHistory = [];

// Raindrop data arrays
const raindropXPositions = [];
const raindropYPositions = [];
let speed       = 10 * 100;  // 10 m/s → 1000 px/s
let spawnRate   = 1000;     // drops per second

let raindropsLeftToSpawn = 0;

// Rectangle parameters
const rect = {
  x: 0,
  y: canvas.height / 2 - 100,
  width: 50,
  height: 200,
  angle: Math.PI / 6,             // radians
  speed: 1 * 100,   // 1 m/s → 100 px/s

  oldX: 0,
  didWrap: false,

  draw() {
    ctx.save();
    ctx.translate(this.x + this.width/2, this.y + this.height/2);
    ctx.rotate(this.angle);
    ctx.fillStyle = 'white';
    ctx.fillRect(-this.width/2, -this.height/2, this.width, this.height);
    ctx.restore();
  },

  update(dt, currentTime) {
    this.oldX = this.x;
    this.x += this.speed * dt;

    // Needs to wrap around as soon as the leading corner hits the edge as raindrops do not spawn outside of the canvas
    const cx = this.x + halfW;
    const leadingX = cx + xExtent;
    if (leadingX >= canvas.width) {
      const newCx = xExtent;
      this.x = newCx - halfW;
      this.oldX = this.x; // Set delta to 0 to avoid calulating hits while wrapping
    this.didWrap = true;
  } else {
    this.didWrap = false;
  }

    const distThisFrame = rect.speed * dt;
    movementHistory.push({ t: currentTime, dist: distThisFrame });
  },

  checkHits( oldRaindropYPositions, currentTime) {
    // Compute old and new centers of rectangle for CCD reference frame
    const previousCenterX = this.oldX + halfW;
    const previousCenterY = this.y + halfH;
    const currentCenterX = this.x + halfW;
    const currentCenterY = this.y + halfH;

    if (this.didWrap) {
    for (let i = raindropXPositions.length - 1; i >= 0; i--) {
      // drop in world space
      const dx = raindropXPositions[i] - currentCenterX;
      const dy = raindropYPositions[i] - currentCenterY;
      // rotate into local space
      const local = transformToLocalSpace({ x: dx, y: dy }, cosθ, sinθ);
      // if inside the AABB, remove it
      if (Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH) {
        raindropXPositions.splice(i, 1);
        raindropYPositions.splice(i, 1);
      }
    }
    return;
  }

    // Iterate backwards so removals don't break index order
    for (let i = raindropXPositions.length - 1; i >= 0; i--) {
      const dropX = raindropXPositions[i];
      const previousDropY = oldRaindropYPositions[i];
      const currentDropY = raindropYPositions[i];

      // STEP 1: Translate drop path into rectangle's motion frame
      const relativeStart = {
        x: dropX - previousCenterX,
        y: previousDropY - previousCenterY
      };
      const relativeEnd = {
        x: dropX - currentCenterX,
        y: currentDropY - currentCenterY
      };

      // STEP 2: Rotate relative positions into rectangle-local axes
      // so rectangle becomes axis-aligned in local space
      const localStartPoint = transformToLocalSpace(relativeStart, cosθ, sinθ);
      const localEndPoint = transformToLocalSpace(relativeEnd, cosθ, sinθ);

      // STEP 3: Perform swept-AABB test in local space
      const collisionResult = performSegmentCCD(
        localStartPoint,
        localEndPoint,
        halfW,
        halfH
      );

      if (collisionResult.hasHit) {

        // STEP 4: Map the local-space hit point back into world coordinates
        const { x: hitLocalX, y: hitLocalY } = collisionResult.localHitPoint;
        const worldSpaceHit = transformToWorldSpace(
          { x: hitLocalX, y: hitLocalY },
          cosθ,
          sinθ
        );
        const hitPointX = worldSpaceHit.x + previousCenterX;
        const hitPointY = worldSpaceHit.y + previousCenterY;

        /* console.log(
          'Collision at',
          { x: hitPointX, y: hitPointY },
          'on side',
          collisionResult.hitSide
        ); */

        hitHistory.push({ t: currentTime, side: collisionResult.hitSide });

        // Remove the raindrop that collided
        raindropXPositions.splice(i, 1);
        raindropYPositions.splice(i, 1);
      }
    }
  }
};

// 1) compute the half-extents once:
const halfW   = rect.width  / 2;
const halfH   = rect.height / 2;
let cosθ    = Math.cos(rect.angle);
let sinθ    = Math.sin(rect.angle);
let xExtent = Math.abs(cosθ * halfW) + Math.abs(sinθ * halfH);

// 2) initialize so leftmost point is at x=0
const startCx = xExtent;
rect.x = startCx - halfW;

(function initializeControls() {
  // 1) Rain speed: default 10 m/s
  const defaultRainMPerS = 10;
  rainSpeedSlider.value       = defaultRainMPerS;
  rainSpeedValue.textContent  = defaultRainMPerS.toFixed(1);
  speed                       = defaultRainMPerS * 100;

  // 2) Rect speed: default 1 m/s
  const defaultRectMPerS = 1;
  rectSpeedSlider.value      = defaultRectMPerS;
  rectSpeedValue.textContent = defaultRectMPerS.toFixed(1);
  rect.speed                 = defaultRectMPerS * 100;

  // 3) Rect angle: default 0°
  const defaultAngleDeg = 0;
  rectAngleSlider.value      = defaultAngleDeg;
  rectAngleValue.textContent = defaultAngleDeg.toFixed(0);
  rect.angle                 = defaultAngleDeg * Math.PI / 180;

  // Recompute CCD trig & extent
  cosθ    = Math.cos(rect.angle);
  sinθ    = Math.sin(rect.angle);
  xExtent = Math.abs(cosθ * halfW) + Math.abs(sinθ * halfH);
})();

// Rain speed slider (m/s → px/s)
rainSpeedSlider.addEventListener('input', () => {
  const rainMPerS = parseFloat(rainSpeedSlider.value);
  speed      = rainMPerS * 100;
  rainSpeedValue.textContent = rainMPerS.toFixed(1);
});

// Rectangle speed slider (m/s → px/s)
rectSpeedSlider.addEventListener('input', () => {
  const rectMPerS = parseFloat(rectSpeedSlider.value);
  rect.speed = rectMPerS * 100;
  rectSpeedValue.textContent = rectMPerS.toFixed(1);
});

// Rectangle angle slider (degrees → radians)
rectAngleSlider.addEventListener('input', () => {
  const deg = parseFloat(rectAngleSlider.value);
  rect.angle = deg * Math.PI / 180;
  rectAngleValue.textContent = deg.toFixed(0);

  // Recompute for CCD & wrap-around logic:
  cosθ   = Math.cos(rect.angle);
  sinθ   = Math.sin(rect.angle);
  xExtent= Math.abs(cosθ*halfW) + Math.abs(sinθ*halfH);

  // Keep the rectangle inside if it’s now poking out
  const cx = rect.x + halfW;
  if (cx + xExtent > canvas.width) {
    rect.x = canvas.width - xExtent - halfW;
  }
});

/**
 * Transforms a point from world-relative coords into rectangle-local axes
 * by undoing the rectangle's rotation.
 * @param {{x, y}} pointRelative - point in rectangle-relative frame
 * @param {number} cosAngle - cos(rectangle.angle)
 * @param {number} sinAngle - sin(rectangle.angle)
 * @returns {{x, y}} pointLocal - in axis-aligned local space
 */
function transformToLocalSpace(pointRelative, cosAngle, sinAngle) {
  return {
    x: pointRelative.x * cosAngle + pointRelative.y * sinAngle,
    y: -pointRelative.x * sinAngle + pointRelative.y * cosAngle
  };
}

/**
 * Transforms a point from rectangle-local axes back into world-relative coords
 * by reapplying the rectangle's rotation.
 * @param {{x, y}} pointLocal
 * @param {number} cosAngle
 * @param {number} sinAngle
 * @returns {{x, y}} pointRelative
 */
function transformToWorldSpace(pointLocal, cosAngle, sinAngle) {
  return {
    x: pointLocal.x * cosAngle - pointLocal.y * sinAngle,
    y: pointLocal.x * sinAngle + pointLocal.y * cosAngle
  };
}

/**
 * Solve for the intersection of moving point R0→R1 against edge A→B.
 * Returns { t, u } or null if no intersection.
 */
function intersectMovingPointVsSegment(R0, R1, A, B) {
  const dRx = R1.x - R0.x;
  const dRy = R1.y - R0.y;
  const dEx = B.x  - A.x;
  const dEy = B.y  - A.y;
  // Solve [ dRx  -dEx ] [ t ] = [ A.x - R0.x ]
  //       [ dRy  -dEy ] [ u ]   [ A.y - R0.y ]
  const det = dRx * (-dEy) - dRy * (-dEx);
  if (Math.abs(det) < 1e-8) return null;  // parallel or degenerate
  const invDet = 1 / det;
  const rx = A.x - R0.x;
  const ry = A.y - R0.y;
  const t = ( rx * (-dEy) - ry * (-dEx) ) * invDet;
  const u = ( dRx * ry - dRy * rx ) * invDet;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { t, u };
  }
  return null;
}

/**
 * CCD by testing against all 4 edges in local space.
 */
function performSegmentCCD(localStart, localEnd, halfW, halfH) {
  const edges = [
    { A:{x:-halfW, y:-halfH}, B:{x: halfW, y:-halfH}, side:'top'    },
    { A:{x: halfW, y:-halfH}, B:{x: halfW, y: halfH}, side:'right'  },
    { A:{x: halfW, y: halfH}, B:{x:-halfW, y: halfH}, side:'bottom' },
    { A:{x:-halfW, y: halfH}, B:{x:-halfW, y:-halfH}, side:'left'   },
  ];

  let firstHit = null;

  for (const {A, B, side} of edges) {
    const hit = intersectMovingPointVsSegment(localStart, localEnd, A, B);
    if (hit) {
      if (hit.u != null && hit.t != null) {
        if (firstHit === null || hit.t < firstHit.t) {
          // record the earliest
          const xHit = localStart.x + (localEnd.x - localStart.x) * hit.t;
          const yHit = localStart.y + (localEnd.y - localStart.y) * hit.t;
          firstHit = { t: hit.t, localHitPoint:{x:xHit,y:yHit}, hitSide:side };
        }
      }
    }
  }

  return firstHit
    ? { hasHit:true, ...firstHit }
    : { hasHit:false };
}

function draw() {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw rectangle
  rect.draw();

  // 6) Draw surviving drops
  for (let i = 0; i < raindropXPositions.length; i++) {
      ctx.fillStyle = 'cyan';
      ctx.fillRect(raindropXPositions[i], raindropYPositions[i], 2, 8);
  }
}

let totalTime      = 0;    // seconds since start
let totalDistance  = 0;    // px the rectangle has moved
let totalLeftHits  = 0;
let totalTopHits   = 0;
let totalRightHits = 0;

let lastStatsUpdateTime = 0;  // seconds

function displayStats(currentTime) {
  if ( currentTime - lastStatsUpdateTime < 100 ) {
    return;
  }

  lastStatsUpdateTime = currentTime;

  const cutoff = currentTime - STATS_DURATION * 1000;
  hitHistory      = hitHistory.filter(e => e.t >= cutoff);
  movementHistory = movementHistory.filter(e => e.t >= cutoff);
  frameTimeHistory = frameTimeHistory.filter(e => e.t >= cutoff);

  frameTimeHistory.push({ t: currentTime, frameTime: performance.now() - currentTime });

  const hitsInWindow     = hitHistory.length;
  const distanceInWindow = movementHistory.reduce((sum, e) => sum + e.dist, 0);
  const totalFrametime = frameTimeHistory.reduce((sum, e) => sum + e.frameTime, 0);
  const avgFrametime = totalFrametime / frameTimeHistory.length;

  const hitsPerSecond = hitsInWindow / STATS_DURATION;
  const hitsPer100px  = distanceInWindow > 0
    ? hitsInWindow / (distanceInWindow / 100)
    : 0;

  // split out sides
  const leftHits  = hitHistory.filter(e => e.side === 'left').length;
  const topHits   = hitHistory.filter(e => e.side === 'top').length;
  const rightHits = hitHistory.filter(e => e.side === 'right').length;

  const leftPct  = hitsInWindow ? (leftHits  / hitsInWindow * 100) : 0;
  const topPct   = hitsInWindow ? (topHits   / hitsInWindow * 100) : 0;
  const rightPct = hitsInWindow ? (rightHits / hitsInWindow * 100) : 0;

  // 6) Update the on‐page DOM
  document.getElementById('hitsPerSecond').textContent = hitsPerSecond.toFixed(2);
  document.getElementById('hitsPerMeter').textContent   = hitsPer100px.toFixed(2);
  document.getElementById('leftPercent').textContent    = leftPct.toFixed(1);
  document.getElementById('topPercent').textContent     = topPct.toFixed(1);
  document.getElementById('rightPercent').textContent   = rightPct.toFixed(1);
  document.getElementById('avgFrametime').textContent = avgFrametime.toFixed(1);
}

// Main loop
function loop(timestamp) {
  const dt = (timestamp - lastTs) / 1000;
  lastTs = timestamp;

  console.log( dt );

  totalTime     += dt;
  totalDistance += rect.speed * dt;

  rect.update(dt, timestamp);

  // Spawn new raindrops
  raindropsLeftToSpawn += spawnRate * dt;
  while (raindropsLeftToSpawn >= 1) {
    raindropXPositions.push(Math.random() * canvas.width);
    raindropYPositions.push(-8);
    raindropsLeftToSpawn -= 1;
  }

  // Move raindrops and cull offscreen
  const oldRaindropYPositions = raindropYPositions.slice();
  for (let i = raindropXPositions.length - 1; i >= 0; i--) {
    raindropYPositions[i] += speed * dt;
    if (raindropYPositions[i] > canvas.height) {
      raindropXPositions.splice(i, 1);
      raindropYPositions.splice(i, 1);
      oldRaindropYPositions.splice(i, 1);
    }
  }

  rect.checkHits( oldRaindropYPositions, timestamp );

  draw();

  displayStats(timestamp);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);