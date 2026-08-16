const { NotFoundError } = require('../errors');

// The durable version of the trace: the complete story of any past call.
module.exports = (deps) => async (req, res, next) => {
  try {
    const row = await deps.traceRepo.get(req.params.requestId);
    if (!row) throw new NotFoundError(`no stored request '${req.params.requestId}'`);
    res.json(row);
  } catch (err) {
    next(err);
  }
};
