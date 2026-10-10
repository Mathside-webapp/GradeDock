/* GradeDock item-analysis formulas and decision criteria.
   Source: user's MA Math Ed 215 Item Analysis slides, pp. 7-13.
   The exported worksheet mirrors the upper/lower 25% example on slide 13. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GradeDockItemAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function difficultyLabel(value) {
    if (value == null || !Number.isFinite(value)) return 'Insufficient data';
    if (value <= 0.40) return 'Difficult';
    if (value <= 0.60) return 'Moderately Difficult';
    return 'Easy';
  }
  function discriminationLabel(value) {
    if (value == null || !Number.isFinite(value)) return 'Insufficient data';
    if (value < 0.20) return 'Not Discriminating';
    if (value < 0.30) return 'Moderately Discriminating';
    return 'Discriminating';
  }
  function action(difficulty, discrimination) {
    if (difficulty == null || discrimination == null) return 'INSUFFICIENT DATA';
    if (discrimination >= 0.30) return 'RETAIN';
    if (difficulty > 0.40 && difficulty <= 0.60) return 'REVISE';
    return discrimination >= 0.20 ? 'REVISE' : 'REMOVE';
  }
  function metrics(upperCorrect, lowerCorrect, groupSize) {
    if (!groupSize) return {
      du:null, dl:null, difficultyIndex:null, difficulty:'Insufficient data',
      discrimination:null, discriminationInterpretation:'Insufficient data', action:'INSUFFICIENT DATA'
    };
    // DU/DL are displayed to two decimals; DI uses raw group counts to match slide 13.
    const du=round2(upperCorrect / groupSize);
    const dl=round2(lowerCorrect / groupSize);
    const difficultyIndex=round2((upperCorrect+lowerCorrect)/(2*groupSize));
    const discrimination=round2(du-dl);
    return {du,dl,difficultyIndex,difficulty:difficultyLabel(difficultyIndex),
      discrimination,discriminationInterpretation:discriminationLabel(discrimination),
      action:action(difficultyIndex,discrimination)};
  }
  const groupSize = n => n >= 4 ? Math.floor(n * .25) : 0;
  return { round2, difficultyLabel, discriminationLabel, action, metrics, groupSize };
});
