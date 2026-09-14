/* Où le site va chercher les données du collecteur.

   Par défaut il devine tout seul, depuis l'URL GitHub Pages :
     https://PSEUDO.github.io/DEPOT/  ->  branche "data" du dépôt PSEUDO/DEPOT
   Les données vivent sur une branche séparée (voir README) pour deux raisons :
   elles changent toutes les 5 minutes, et un push sur cette branche ne relance
   pas la construction de GitHub Pages (qui est limitée à 10 builds par heure).

   Si tu veux forcer un dépôt précis, remplis REPO ci-dessous, par exemple :
     const REPO = { user: "ruexonos", name: "roscout", branch: "data" };
*/
const REPO = null;

window.RS_CONFIG = (() => {
  let user = null, name = null;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) {
    user = m[1];
    const seg = location.pathname.split("/").filter(Boolean);
    name = seg.length ? seg[0] : user + ".github.io";
  }
  const r = REPO || (user ? { user, name, branch: "data" } : null);
  const urls = [];
  if (r) urls.push(`https://raw.githubusercontent.com/${r.user}/${r.name}/${r.branch}/radar.json`);
  urls.push("data/radar.json");      // repli : données commitées à côté du site
  urls.push("../data/radar.json");   // repli : site servi depuis un sous-dossier
  return { repo: r, urls, refreshMs: 120000 };
})();
