import pool from '../config/db.js';
import { trackLeopardsPackets, mapLeopardsStatus } from '../controllers/courierController.js';
import { applySyncedOrderStatus } from '../controllers/ordersController.js';

const TRACKABLE_STATUSES = ['shipped', 'out_for_delivery'];
const CHUNK_SIZE = 50;

// Runs on an interval from server.js. Pulls live status from Leopards for
// every in-transit order and advances our own order status to match —
// reusing the same STATUS_TRANSITIONS machine (and status-change emails)
// that admin-driven updates use, so this can never skip/corrupt a state.
export async function syncLeopardsTracking() {
  try {
    const [businesses] = await pool.query(
      `SELECT DISTINCT business_id FROM courier_settings WHERE enabled = 1 AND provider LIKE '%leopards%'`
    );
    for (const { business_id } of businesses) {
      await syncBusiness(business_id).catch((err) => console.error(`[leopardsSync] business ${business_id} failed:`, err.message));
    }
  } catch (err) {
    console.error('[leopardsSync] failed:', err.message);
  }
}

async function syncBusiness(businessId) {
  const [orders] = await pool.query(
    `SELECT id, status, tracking_number FROM orders
     WHERE business_id = ? AND status IN (?) AND tracking_number IS NOT NULL AND tracking_number != ''`,
    [businessId, TRACKABLE_STATUSES]
  );
  if (orders.length === 0) return;

  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    let packets;
    try {
      packets = await trackLeopardsPackets(businessId, chunk.map((o) => o.tracking_number));
    } catch (err) {
      console.error(`[leopardsSync] track call failed for business ${businessId}:`, err.message);
      continue;
    }

    for (const order of chunk) {
      const packet = packets.find((p) => p.track_number === order.tracking_number || p.cn_number === order.tracking_number);
      if (!packet) continue;

      const rawStatus = packet.booked_packet_status || packet.status || '';
      const mapped = mapLeopardsStatus(rawStatus);
      if (!mapped || mapped === order.status) continue;

      const applied = await applySyncedOrderStatus(businessId, order.id, order.status, mapped);
      if (applied) console.log(`[leopardsSync] order ${order.id}: ${order.status} -> ${mapped} (Leopards: "${rawStatus}")`);
    }
  }
}
