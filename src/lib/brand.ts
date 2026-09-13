/** User-facing product name. Internal ids (gridline.env, Docker, Git paths) stay as-is. */
export const APP_NAME = "ISP Solutions";
/** RouterOS-safe id for scripts, schedulers, API users, and address lists. */
export const APP_SLUG = "ispsolutions";
export const ROS_PULL_SCRIPT = `${APP_SLUG}-pull`;
export const ROS_AGENT_SCHEDULER = `${APP_SLUG}-agent`;
export const ROS_PULL_FILE = `${APP_SLUG}-pull.rsc`;
export const ROS_ENROLL_FILE = `${APP_SLUG}-enroll.rsc`;
export const ROS_ACTIVE_LIST = `${APP_SLUG}-active`;
export const ROS_API_USER = APP_SLUG;
/** Overlay name on MikroTik and on the VPS hub (`wg-quick`). */
export const ROS_WG_INTERFACE = `wg-${APP_SLUG}`;
export const ROS_WG_INTERFACE_LEGACY = "wg-gridline";
