// Temporary debug endpoint — DELETE after troubleshooting
module.exports = (req, res) => {
  res.json({
    ADMIN_USER: process.env.ADMIN_USER || '(not set)',
    ADMIN_PASS_LENGTH: process.env.ADMIN_PASS ? process.env.ADMIN_PASS.length : 0,
    ADMIN_PASS_FIRST2: process.env.ADMIN_PASS ? process.env.ADMIN_PASS.slice(0, 2) : '(not set)',
    JWT_SECRET_SET: !!process.env.JWT_SECRET,
    KV_URL_SET: !!process.env.KV_REST_API_URL,
  });
};
