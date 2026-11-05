/* Anthem Square — printable cards (two per A4) + interactive print preview.
 * Builds sheets from the SAVED card mappings (never regenerates anything) and fits
 * every song's text into its square: wrap → shrink → minimum readable size → warn. */
(function () {
  'use strict';
  var TITLE_MAX = 11, TITLE_MIN = 6.5, ARTIST_MAX = 7.8, ARTIST_MIN = 5.8;
  var PREVIEW = /preview=1/.test(location.search);
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return String(n).padStart(3, '0'); }

  var mcell = document.getElementById('mcell');
  function fits(cell) { return cell.scrollHeight <= cell.clientHeight + 0.5 && cell.scrollWidth <= cell.clientWidth + 0.5; }

  // Words must stay whole at the chosen size (only truly huge words may break).
  var probe = null;
  function longestWordFits(t, size, bold) {
    if (!probe) { probe = document.createElement('span'); probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;font-family:Inter,sans-serif'; document.body.appendChild(probe); }
    probe.style.fontWeight = bold ? 800 : 400; probe.style.fontSize = size + 'pt';
    var w = 0; t.split(/\s+/).forEach(function (x) { probe.textContent = x; w = Math.max(w, probe.getBoundingClientRect().width); });
    return w <= mcell.clientWidth - 6;
  }

  function fitSong(title, artist, scale, showArtist) {
    var t = mcell.querySelector('.t'), a = mcell.querySelector('.a');
    t.textContent = title; a.textContent = showArtist ? artist : ''; a.style.display = showArtist && artist ? '' : 'none';
    mcell.classList.remove('clamp');
    var lo = TITLE_MIN * scale, hi = TITLE_MAX * scale * (showArtist ? 1 : 1.12), best = null;
    var artistFor = function (ts) { return Math.max(ARTIST_MIN * scale, Math.min(ARTIST_MAX * scale, ts * 0.74)); };
    for (var i = 0; i < 9; i++) {
      var mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'pt'; a.style.fontSize = artistFor(mid) + 'pt';
      if (fits(mcell) && longestWordFits(title, mid, true)) { best = mid; lo = mid; } else hi = mid;
    }
    if (best != null) return { t: best, a: artistFor(best), clamp: false, warn: null };
    // At the minimum size: allow long words to break; if it still doesn't fit, warn (never silently).
    t.style.fontSize = TITLE_MIN * scale + 'pt'; a.style.fontSize = ARTIST_MIN * scale + 'pt';
    if (fits(mcell)) return { t: TITLE_MIN * scale, a: ARTIST_MIN * scale, clamp: false, warn: 'word-break' };
    mcell.classList.add('clamp');
    return { t: TITLE_MIN * scale, a: ARTIST_MIN * scale, clamp: true, warn: 'too-long' };
  }

  /* low-ink outline version of the Anthem Square icon (inline so it is always in the PDF) */
  var PRINT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1218 1218"><g transform="translate(-19.5 8.2)"><path fill="#102542" d="M606.0,1147.7C632.8,1146.0 648.4,1144.1 670.5,1139.7C709.3,1132.1 745.2,1119.8 781.2,1102.0C818.8,1083.4 855.5,1058.2 886.5,1029.7C899.9,1017.4 919.8,996.6 929.8,984.3C930.7,983.2 931.7,982.5 932.0,982.7C932.3,982.9 932.5,986.7 932.5,994.4C932.5,1024.0 935.3,1040.4 943.8,1059.9C951.6,1077.8 962.3,1092.0 974.9,1101.4C988.1,1111.2 1002.3,1116.4 1020.3,1118.2C1027.3,1118.9 1038.2,1119.0 1104.1,1119.0C1145.7,1118.9 1189.4,1118.7 1201.2,1118.5C1222.2,1118.2 1222.8,1118.2 1225.8,1117.0C1227.9,1116.2 1229.6,1115.0 1231.8,1112.8C1235.6,1109.0 1236.9,1105.7 1237.5,1098.8C1237.8,1096.0 1238.0,1048.0 1238.1,991.2C1238.1,895.6 1238.1,888.6 1237.3,886.6C1236.2,884.0 1233.6,881.7 1230.9,881.0C1229.4,880.6 1224.1,880.5 1212.5,880.8C1189.2,881.3 1182.8,880.4 1172.2,875.2C1155.9,867.2 1144.0,850.4 1141.5,831.6C1141.1,829.0 1141.0,715.1 1141.2,472.0C1141.4,276.3 1141.6,107.4 1141.7,96.5L1141.8,76.8L1140.4,74.2C1139.6,72.8 1138.2,70.9 1137.2,70.1C1133.2,66.8 1141.3,67.0 1027.2,67.0C926.0,67.0 923.4,67.0 921.0,68.0C917.3,69.4 915.3,71.1 913.7,74.4L912.2,77.2L912.2,96.8C912.2,107.5 912.5,137.0 912.7,162.3C913.0,194.9 913.0,208.4 912.6,208.7C912.3,208.9 909.5,206.2 906.2,202.6C903.0,199.1 895.8,191.8 890.3,186.2C837.0,133.2 789.5,101.7 730.0,79.8C688.4,64.6 650.6,57.5 595.2,54.7C541.1,52.0 489.4,57.2 436.5,70.8C423.1,74.2 403.1,80.4 388.2,85.6C291.5,119.7 203.2,182.8 140.9,262.5C121.4,287.6 105.1,312.1 90.1,339.0C83.3,351.3 71.1,375.6 66.0,387.0C41.2,442.7 26.1,499.1 20.7,556.8C19.9,564.6 19.8,571.1 19.8,593.8C19.8,625.0 20.5,637.4 23.5,658.5C32.5,721.9 55.7,790.9 86.4,846.0C95.9,863.0 107.4,881.4 116.2,893.2C139.2,924.6 147.7,935.5 163.1,953.2C204.7,1000.9 264.8,1049.8 322.2,1082.9C367.5,1108.9 418.8,1128.6 465.2,1137.7C485.7,1141.7 520.0,1146.1 544.0,1147.7C557.3,1148.6 591.6,1148.7 606.0,1147.7Z"/><path fill="#FFFFFF" fill-rule="evenodd" d="M625.4,349.4C625.9,348.9 626.0,332.4 626.0,277.8C626.0,238.7 625.8,206.5 625.6,206.2C625.0,205.3 621.8,204.8 601.8,202.5C577.7,199.9 548.0,200.0 520.8,203.0C508.4,204.4 508.2,204.4 507.5,205.3C506.6,206.4 507.0,348.1 508.0,349.2C508.6,349.9 514.3,350.0 566.7,350.0C611.2,350.0 624.9,349.9 625.4,349.4ZM626.5,943.0C627.2,942.6 627.2,934.1 627.1,871.2C627.1,831.9 626.9,799.7 626.6,799.4C626.4,799.2 600.1,799.0 568.3,799.0C513.5,798.9 510.3,799.0 509.6,799.8C508.9,800.8 508.8,839.7 509.3,903.7C509.6,935.7 509.8,942.2 510.4,942.8C511.0,943.4 519.8,943.5 568.4,943.5C603.8,943.5 626.0,943.3 626.5,943.0ZM361.7,942.2C361.9,941.8 362.0,909.5 362.0,870.6C362.0,816.1 361.9,799.6 361.4,799.1C360.9,798.6 347.3,798.5 302.9,798.5C251.0,798.5 245.0,798.6 244.3,799.3C243.6,799.9 243.5,801.5 243.6,808.7C243.6,813.4 243.8,820.4 243.9,824.2L244.3,831.2L248.3,836.8C271.2,868.3 298.1,896.6 326.5,919.1C335.9,926.5 353.4,939.1 358.0,941.7C360.6,943.2 361.3,943.3 361.7,942.2ZM757.7,943.2C758.4,942.9 758.5,936.1 758.5,871.2C758.5,803.4 758.5,799.5 757.6,799.1C757.1,798.9 731.1,798.8 699.9,798.8C650.0,798.8 642.9,798.9 642.4,799.5C641.8,800.5 642.4,941.4 643.1,942.6C643.5,943.5 646.7,943.5 700.2,943.5C731.4,943.5 757.3,943.4 757.7,943.2ZM493.4,942.9C494.3,942.0 494.3,801.1 493.4,799.8C492.8,799.0 489.5,798.9 435.6,798.8C385.3,798.8 378.4,798.8 378.0,799.5C377.4,800.4 377.4,940.8 378.0,942.4L378.5,943.5L435.6,943.5C479.4,943.5 492.9,943.4 493.4,942.9ZM781.1,936.7C801.9,922.5 821.4,906.1 841.6,885.7C854.8,872.2 862.4,863.6 873.2,849.5C878.8,842.3 889.1,827.7 890.4,825.2C890.8,824.4 891.0,820.1 891.0,811.8C891.0,800.2 890.9,799.5 890.0,799.0C888.5,798.2 775.4,798.3 774.6,799.1C774.1,799.6 774.0,815.8 774.0,869.3C774.0,907.6 774.1,939.3 774.3,939.7C774.5,940.1 774.8,940.5 775.0,940.5C775.3,940.5 778.0,938.8 781.1,936.7ZM757.4,349.3C757.9,349.0 758.0,338.8 758.0,301.0L758.0,253.1L756.6,252.1C753.3,249.8 740.4,242.9 730.8,238.2C704.4,225.4 681.4,217.3 654.5,211.1C644.5,208.8 642.0,208.4 641.1,209.1C640.4,209.7 640.4,215.9 640.7,279.2C641.0,343.8 641.1,348.8 641.9,349.4C642.6,349.9 653.4,350.0 699.8,349.9C731.1,349.8 757.0,349.6 757.4,349.3ZM491.9,349.4C492.6,348.7 492.6,287.3 492.1,235.0L491.8,207.8L488.5,207.9C486.7,208.0 483.3,208.5 481.0,209.0C478.7,209.6 474.9,210.5 472.6,211.0C455.5,215.1 447.9,217.3 432.1,223.0C424.3,225.8 411.6,231.0 405.1,234.0C402.8,235.1 400.8,236.0 400.7,236.0C400.2,236.0 379.2,246.7 377.9,247.6L376.5,248.6L376.5,298.7C376.5,337.0 376.6,348.9 377.1,349.4C378.0,350.3 491.0,350.3 491.9,349.4ZM361.2,637.7C361.9,637.0 362.0,630.5 362.0,573.1C362.0,524.1 361.9,509.1 361.4,508.6C360.9,508.1 347.0,508.0 301.7,508.0L242.5,508.0L242.2,509.4C241.6,511.8 242.4,637.1 243.1,637.8C243.5,638.4 253.3,638.5 302.0,638.5C354.5,638.5 360.5,638.4 361.2,637.7ZM626.8,717.8L626.8,652.2L568.0,652.1C529.7,652.0 509.1,652.2 508.8,652.5C508.5,652.8 508.4,672.6 508.4,709.4C508.6,764.6 508.8,782.2 509.3,783.1C509.4,783.3 535.5,783.4 568.2,783.4L626.8,783.2L626.8,717.8ZM361.9,718.0C362.0,673.2 361.8,653.1 361.5,652.8C360.7,652.0 244.0,652.4 243.1,653.2C242.5,653.6 242.4,661.2 242.7,699.7C243.0,749.6 243.5,782.0 243.8,782.6C244.0,782.8 270.5,782.9 302.9,782.9L361.8,782.8L361.9,718.0ZM626.3,637.2C627.0,636.4 627.1,631.6 626.7,572.5C626.5,537.5 626.2,508.6 626.0,508.4C625.9,508.2 599.3,508.1 567.0,508.1L508.2,508.2L508.1,571.8C508.0,612.4 508.2,635.9 508.5,636.7L509.0,638.0L567.2,638.0C620.8,638.0 625.5,637.9 626.3,637.2ZM361.5,491.7C362.2,490.0 362.2,367.5 361.5,365.8L361.0,364.5L303.6,364.6L246.3,364.8L243.8,368.2L241.4,371.8L241.7,431.8C242.0,471.6 242.3,492.0 242.6,492.4C243.0,492.9 255.5,493.0 302.1,493.0L361.0,493.0L361.5,491.7ZM493.6,718.0C493.5,682.1 493.3,652.6 493.2,652.4C492.9,651.8 378.4,651.9 377.6,652.4C377.0,652.8 376.9,663.6 377.1,717.6C377.2,753.1 377.4,782.5 377.7,782.9C378.0,783.4 390.0,783.5 435.9,783.4L493.8,783.2L493.6,718.0ZM890.4,782.9C891.3,782.0 891.3,653.5 890.4,652.6C889.9,652.1 876.3,652.0 832.2,652.0L774.5,652.0L773.9,653.1C773.1,654.6 773.7,781.8 774.6,782.8C775.3,783.8 889.5,783.8 890.4,782.9ZM626.2,429.5C626.2,394.7 626.1,365.9 625.9,365.4C625.5,364.5 622.4,364.5 566.6,364.6L507.8,364.8L507.8,428.0C507.8,462.8 507.9,491.6 508.1,492.1C508.5,493.0 511.6,493.0 567.4,492.9L626.2,492.8L626.2,429.5ZM890.2,636.7C890.9,636.0 891.0,629.6 890.9,573.6C890.9,539.3 890.7,510.6 890.6,509.8L890.2,508.2L832.1,508.1L774.0,508.0L773.5,509.1C772.9,510.7 773.5,636.1 774.1,636.9C774.5,637.4 786.7,637.5 832.0,637.5C883.5,637.5 889.5,637.4 890.2,636.7ZM757.9,782.7C758.4,782.6 758.5,769.2 758.4,717.4L758.2,652.2L700.2,652.2L642.2,652.2L642.2,717.5L642.2,782.8L644.5,783.0C647.2,783.3 757.0,783.1 757.9,782.7ZM757.9,637.3C758.1,637.1 758.3,608.2 758.4,573.0C758.5,519.4 758.4,509.0 757.8,508.6C757.3,508.1 741.9,508.0 699.4,508.1L641.8,508.2L641.8,572.3C641.8,627.5 641.8,636.5 642.5,637.2C643.2,638.0 646.4,638.1 700.4,637.9C731.8,637.7 757.7,637.5 757.9,637.3ZM889.7,492.7C890.4,492.4 890.5,487.2 890.5,438.9C890.5,389.3 890.4,385.4 889.6,384.1C887.2,380.3 877.0,365.6 876.4,365.1C875.8,364.6 863.2,364.5 824.4,364.6L773.2,364.8L773.1,427.8C773.0,462.4 773.1,491.3 773.2,491.9L773.5,493.0L831.2,493.0C863.0,493.0 889.3,492.9 889.7,492.7ZM493.1,637.3C493.6,636.7 493.2,509.2 492.7,508.5C492.3,507.7 377.9,507.8 377.1,508.6C376.4,509.3 376.4,573.6 376.9,616.0L377.2,637.7L378.4,638.0C379.0,638.1 405.0,638.2 436.1,638.1C479.0,638.0 492.8,637.8 493.1,637.3ZM758.2,492.2C758.6,491.2 758.5,371.6 758.1,367.8L757.8,364.8L699.5,364.8L641.2,364.8L641.1,427.8C641.0,462.4 641.1,491.3 641.2,491.9L641.5,493.0L699.7,493.0C752.3,493.0 757.9,492.9 758.2,492.2ZM492.8,429.5C492.9,391.5 492.7,365.9 492.4,365.4C492.0,364.5 488.7,364.5 434.8,364.5C391.1,364.5 377.6,364.6 377.1,365.1C376.6,365.6 376.5,380.3 376.5,428.6C376.5,463.1 376.6,491.8 376.8,492.2C377.1,492.9 382.5,493.0 434.9,492.9L492.8,492.8L492.8,429.5ZM361.4,349.1C361.9,347.9 361.8,258.2 361.3,257.7C360.7,257.1 357.2,259.1 345.5,266.9C313.9,288.1 287.3,312.4 263.0,342.5C258.5,348.1 258.1,348.8 258.8,349.4C259.5,349.9 270.6,350.0 310.4,350.0C358.1,350.0 361.1,350.0 361.4,349.1ZM544.2,628.6C532.9,625.3 526.2,615.1 528.0,603.6C530.3,587.8 546.2,579.2 561.3,585.6C563.4,586.5 565.2,587.0 565.4,586.8C565.6,586.6 565.8,571.5 565.8,553.2L565.9,519.9L567.0,518.7C568.9,516.7 570.4,516.8 576.1,518.9C578.9,520.0 583.7,521.7 586.8,522.7C589.8,523.7 593.9,525.4 596.0,526.6C602.9,530.4 608.3,537.3 610.2,544.8C612.4,553.4 609.8,567.5 605.9,567.9C604.8,568.0 604.5,567.8 604.2,566.7C603.0,560.5 601.3,557.3 597.4,553.7C595.7,552.2 593.3,550.4 591.8,549.7C588.5,548.0 582.9,546.5 579.7,546.5L577.1,546.5L576.8,556.4C576.7,561.8 576.6,575.5 576.6,586.8C576.6,599.9 576.4,608.2 576.0,609.7C574.6,616.1 568.5,623.5 562.4,626.4C555.9,629.5 549.9,630.2 544.2,628.6ZM226.7,638.7C227.4,638.4 227.5,634.6 227.5,600.3C227.5,579.3 227.4,550.0 227.2,535.1L226.8,508.1L220.3,507.8C216.7,507.6 205.3,507.7 195.0,507.9L176.3,508.2L175.9,509.8C173.6,517.7 169.6,536.8 168.0,547.5C165.8,561.9 164.0,583.0 164.0,594.5C164.0,606.3 166.0,635.1 167.0,637.8L167.5,639.0L196.7,639.0C212.8,639.0 226.3,638.9 226.7,638.7ZM864.4,349.2C866.0,347.7 845.8,323.8 828.2,306.5C812.0,290.5 799.1,280.0 780.5,267.3C775.0,263.6 773.5,262.8 773.1,263.3C772.6,263.7 772.4,339.5 772.9,344.8L773.2,349.2L776.8,349.5C780.4,349.8 864.1,349.5 864.4,349.2ZM227.1,783.2C228.0,782.9 228.0,779.5 228.0,719.8C228.0,685.1 227.8,655.9 227.6,654.8L227.2,652.8L198.5,652.9C182.2,652.9 169.6,653.2 169.4,653.4C168.4,654.4 173.4,679.4 177.5,693.6C185.4,721.7 195.2,746.4 208.3,772.0C211.2,777.6 214.0,782.5 214.4,782.9C215.0,783.4 216.9,783.5 220.8,783.5C223.8,783.4 226.6,783.3 227.1,783.2ZM958.9,636.6C960.4,635.6 961.5,604.2 960.5,587.8C959.5,569.8 957.4,552.8 954.5,538.8C953.4,533.5 947.8,511.3 947.0,509.3L946.6,508.2L931.8,507.9C923.7,507.7 914.5,507.7 911.5,507.9L906.0,508.1L906.0,572.2C906.0,607.5 906.1,636.5 906.3,636.7C906.8,637.1 958.1,637.1 958.9,636.6ZM919.4,775.8C923.7,767.3 928.1,757.8 932.1,748.0C935.3,740.1 940.6,726.3 941.4,723.5C941.7,722.5 943.1,718.2 944.5,713.8C947.4,704.8 951.3,689.7 953.2,680.1C955.1,671.1 957.5,656.2 957.5,653.9L957.5,652.0L931.9,652.1L906.2,652.2L906.3,716.8C906.3,752.2 906.4,781.7 906.6,782.1C906.9,782.9 907.5,783.0 911.4,782.9L915.8,782.8L919.4,775.8ZM579.8,1008.0C592.1,1007.3 603.3,1006.2 615.2,1004.5C621.0,1003.6 626.1,1002.8 626.6,1002.7C627.5,1002.4 627.5,1001.1 627.4,980.8L627.2,959.2L569.1,959.1C523.0,959.0 510.7,959.1 510.1,959.6C509.4,960.2 509.4,962.9 509.7,981.7C509.8,994.5 510.2,1003.4 510.5,1003.7C511.4,1004.6 530.5,1007.1 544.2,1008.0C552.6,1008.5 570.2,1008.6 579.8,1008.0ZM494.2,979.8C494.0,969.1 493.8,960.0 493.7,959.6C493.6,959.1 482.6,959.0 441.0,959.0C410.3,959.0 388.4,959.2 388.3,959.5C387.5,960.8 422.7,978.3 439.5,984.8C453.4,990.3 472.0,996.1 486.0,999.3C492.4,1000.7 493.3,1000.8 493.9,1000.1C494.3,999.6 494.4,994.7 494.2,979.8ZM226.8,468.2C226.8,429.2 226.4,397.7 226.0,396.9C225.7,396.6 225.5,396.4 225.4,396.5C224.3,397.9 216.4,411.5 211.1,421.0C205.1,431.9 195.2,453.3 190.1,466.0C186.3,475.6 181.0,491.5 181.3,492.1C181.5,492.3 191.7,492.5 204.2,492.4L226.8,492.2L226.8,468.2ZM650.2,997.8C677.1,991.3 705.1,980.6 731.7,966.6C738.0,963.3 743.3,960.4 743.4,960.1C743.6,959.6 646.5,958.7 644.4,959.3L643.0,959.6L643.0,979.0C643.0,989.6 643.1,998.5 643.3,998.7C643.9,999.2 645.0,999.1 650.2,997.8ZM941.0,491.8C941.0,489.5 933.6,469.6 927.2,454.6C920.9,439.8 907.5,413.6 906.1,413.1C905.6,413.0 905.5,420.9 905.5,451.9C905.5,473.4 905.6,491.3 905.8,491.7C906.1,492.4 908.1,492.5 923.6,492.5C938.5,492.5 941.0,492.4 941.0,491.8Z"/><path fill="#FF5B32" fill-rule="evenodd" d="M493.4,942.9C494.3,942.0 494.3,801.1 493.4,799.8C492.8,799.0 489.5,798.9 435.6,798.8C385.3,798.8 378.4,798.8 378.0,799.5C377.4,800.4 377.4,940.8 378.0,942.4L378.5,943.5L435.6,943.5C479.4,943.5 492.9,943.4 493.4,942.9ZM626.5,943.0C627.2,942.6 627.2,934.1 627.1,871.2C627.1,831.9 626.9,799.7 626.6,799.4C626.4,799.2 600.1,799.0 568.3,799.0C513.5,798.9 510.3,799.0 509.6,799.8C508.9,800.8 508.8,839.7 509.3,903.7C509.6,935.7 509.8,942.2 510.4,942.8C511.0,943.4 519.8,943.5 568.4,943.5C603.8,943.5 626.0,943.3 626.5,943.0ZM757.7,943.2C758.4,942.9 758.5,936.1 758.5,871.2C758.5,803.4 758.5,799.5 757.6,799.1C757.1,798.9 731.1,798.8 699.9,798.8C650.0,798.8 642.9,798.9 642.4,799.5C641.8,800.5 642.4,941.4 643.1,942.6C643.5,943.5 646.7,943.5 700.2,943.5C731.4,943.5 757.3,943.4 757.7,943.2ZM361.7,942.2C361.9,941.8 362.0,909.5 362.0,870.6C362.0,816.1 361.9,799.6 361.4,799.1C360.9,798.6 347.3,798.5 302.9,798.5C251.0,798.5 245.0,798.6 244.3,799.3C243.6,799.9 243.5,801.5 243.6,808.7C243.6,813.4 243.8,820.4 243.9,824.2L244.3,831.2L248.3,836.8C271.2,868.3 298.1,896.6 326.5,919.1C335.9,926.5 353.4,939.1 358.0,941.7C360.6,943.2 361.3,943.3 361.7,942.2ZM781.1,936.7C801.9,922.5 821.4,906.1 841.6,885.7C854.8,872.2 862.4,863.6 873.2,849.5C878.8,842.3 889.1,827.7 890.4,825.2C890.8,824.4 891.0,820.1 891.0,811.8C891.0,800.2 890.9,799.5 890.0,799.0C888.5,798.2 775.4,798.3 774.6,799.1C774.1,799.6 774.0,815.8 774.0,869.3C774.0,907.6 774.1,939.3 774.3,939.7C774.5,940.1 774.8,940.5 775.0,940.5C775.3,940.5 778.0,938.8 781.1,936.7ZM890.4,782.9C891.3,782.0 891.3,653.5 890.4,652.6C889.9,652.1 876.3,652.0 832.2,652.0L774.5,652.0L773.9,653.1C773.1,654.6 773.7,781.8 774.6,782.8C775.3,783.8 889.5,783.8 890.4,782.9ZM361.2,637.7C361.9,637.0 362.0,630.5 362.0,573.1C362.0,524.1 361.9,509.1 361.4,508.6C360.9,508.1 347.0,508.0 301.7,508.0L242.5,508.0L242.2,509.4C241.6,511.8 242.4,637.1 243.1,637.8C243.5,638.4 253.3,638.5 302.0,638.5C354.5,638.5 360.5,638.4 361.2,637.7ZM493.1,637.3C493.6,636.7 493.2,509.2 492.7,508.5C492.3,507.7 377.9,507.8 377.1,508.6C376.4,509.3 376.4,573.6 376.9,616.0L377.2,637.7L378.4,638.0C379.0,638.1 405.0,638.2 436.1,638.1C479.0,638.0 492.8,637.8 493.1,637.3ZM626.3,637.2C627.0,636.4 627.1,631.6 626.7,572.5C626.5,537.5 626.2,508.6 626.0,508.4C625.9,508.2 599.3,508.1 567.0,508.1L508.2,508.2L508.1,571.8C508.0,612.4 508.2,635.9 508.5,636.7L509.0,638.0L567.2,638.0C620.8,638.0 625.5,637.9 626.3,637.2ZM757.9,637.3C758.1,637.1 758.3,608.2 758.4,573.0C758.5,519.4 758.4,509.0 757.8,508.6C757.3,508.1 741.9,508.0 699.4,508.1L641.8,508.2L641.8,572.3C641.8,627.5 641.8,636.5 642.5,637.2C643.2,638.0 646.4,638.1 700.4,637.9C731.8,637.7 757.7,637.5 757.9,637.3ZM890.2,636.7C890.9,636.0 891.0,629.6 890.9,573.6C890.9,539.3 890.7,510.6 890.6,509.8L890.2,508.2L832.1,508.1L774.0,508.0L773.5,509.1C772.9,510.7 773.5,636.1 774.1,636.9C774.5,637.4 786.7,637.5 832.0,637.5C883.5,637.5 889.5,637.4 890.2,636.7ZM544.2,628.6C532.9,625.3 526.2,615.1 528.0,603.6C530.3,587.8 546.2,579.2 561.3,585.6C563.4,586.5 565.2,587.0 565.4,586.8C565.6,586.6 565.8,571.5 565.8,553.2L565.9,519.9L567.0,518.7C568.9,516.7 570.4,516.8 576.1,518.9C578.9,520.0 583.7,521.7 586.8,522.7C589.8,523.7 593.9,525.4 596.0,526.6C602.9,530.4 608.3,537.3 610.2,544.8C612.4,553.4 609.8,567.5 605.9,567.9C604.8,568.0 604.5,567.8 604.2,566.7C603.0,560.5 601.3,557.3 597.4,553.7C595.7,552.2 593.3,550.4 591.8,549.7C588.5,548.0 582.9,546.5 579.7,546.5L577.1,546.5L576.8,556.4C576.7,561.8 576.6,575.5 576.6,586.8C576.6,599.9 576.4,608.2 576.0,609.7C574.6,616.1 568.5,623.5 562.4,626.4C555.9,629.5 549.9,630.2 544.2,628.6ZM361.5,491.7C362.2,490.0 362.2,367.5 361.5,365.8L361.0,364.5L303.6,364.6L246.3,364.8L243.8,368.2L241.4,371.8L241.7,431.8C242.0,471.6 242.3,492.0 242.6,492.4C243.0,492.9 255.5,493.0 302.1,493.0L361.0,493.0L361.5,491.7ZM361.4,349.1C361.9,347.9 361.8,258.2 361.3,257.7C360.7,257.1 357.2,259.1 345.5,266.9C313.9,288.1 287.3,312.4 263.0,342.5C258.5,348.1 258.1,348.8 258.8,349.4C259.5,349.9 270.6,350.0 310.4,350.0C358.1,350.0 361.1,350.0 361.4,349.1ZM491.9,349.4C492.6,348.7 492.6,287.3 492.1,235.0L491.8,207.8L488.5,207.9C486.7,208.0 483.3,208.5 481.0,209.0C478.7,209.6 474.9,210.5 472.6,211.0C455.5,215.1 447.9,217.3 432.1,223.0C424.3,225.8 411.6,231.0 405.1,234.0C402.8,235.1 400.8,236.0 400.7,236.0C400.2,236.0 379.2,246.7 377.9,247.6L376.5,248.6L376.5,298.7C376.5,337.0 376.6,348.9 377.1,349.4C378.0,350.3 491.0,350.3 491.9,349.4ZM625.4,349.4C625.9,348.9 626.0,332.4 626.0,277.8C626.0,238.7 625.8,206.5 625.6,206.2C625.0,205.3 621.8,204.8 601.8,202.5C577.7,199.9 548.0,200.0 520.8,203.0C508.4,204.4 508.2,204.4 507.5,205.3C506.6,206.4 507.0,348.1 508.0,349.2C508.6,349.9 514.3,350.0 566.7,350.0C611.2,350.0 624.9,349.9 625.4,349.4ZM757.4,349.3C757.9,349.0 758.0,338.8 758.0,301.0L758.0,253.1L756.6,252.1C753.3,249.8 740.4,242.9 730.8,238.2C704.4,225.4 681.4,217.3 654.5,211.1C644.5,208.8 642.0,208.4 641.1,209.1C640.4,209.7 640.4,215.9 640.7,279.2C641.0,343.8 641.1,348.8 641.9,349.4C642.6,349.9 653.4,350.0 699.8,349.9C731.1,349.8 757.0,349.6 757.4,349.3ZM864.4,349.2C866.0,347.7 845.8,323.8 828.2,306.5C812.0,290.5 799.1,280.0 780.5,267.3C775.0,263.6 773.5,262.8 773.1,263.3C772.6,263.7 772.4,339.5 772.9,344.8L773.2,349.2L776.8,349.5C780.4,349.8 864.1,349.5 864.4,349.2Z"/></g></svg>';

  function patternSvg(cells) {
    var s = '<svg viewBox="0 0 29 29" class="pat">';
    for (var i = 0; i < 25; i++) { var x = (i % 5) * 6, y = Math.floor(i / 5) * 6; s += '<rect x="' + x + '" y="' + y + '" width="5" height="5" rx="1" class="' + (cells[i] ? 'on' : 'off') + '"/>'; }
    return s + '</svg>';
  }

  function buildCard(job, card) {
    var c = el('div', 'card'); c.setAttribute('data-card', card.no);
    var head = el('div', 'head');
    var brand = el('div', 'brand' + (job.logo ? ' haslogo' : ''));
    if (job.logo) { var img = el('img'); img.src = job.logo; brand.appendChild(img); }
    var ic = el('div', 'as-ic'); ic.innerHTML = PRINT_ICON; brand.appendChild(ic);
    var wm = el('div', 'as-w'); wm.innerHTML = '<b>ANTHEM</b><b>SQUARE</b><small>MUSIC VIDEO BINGO</small>'; brand.appendChild(wm);
    head.appendChild(brand);
    var meta = el('div', 'meta');
    meta.appendChild(el('b', null, job.game.name));
    meta.appendChild(el('div', null, [job.game.date, job.game.venue].filter(Boolean).join('  ·  ')));
    var owner = job.names && job.names[card.no];
    if (owner) { var ow = el('div', 'owner'); ow.appendChild(document.createTextNode('Player: ')); ow.appendChild(el('b', null, owner)); meta.appendChild(ow); }
    else meta.appendChild(el('div', 'hint', 'Mark each song as you hear it'));
    head.appendChild(meta);
    var no = el('div', 'cardno'); no.appendChild(el('div', 'k', 'CARD No.')); no.appendChild(el('div', 'v', pad(card.no)));
    head.appendChild(no);
    if (job.qrs[card.no]) { var q = el('div', 'qr'); q.innerHTML = job.qrs[card.no]; q.setAttribute('data-expect', 'CMB1|' + job.game.id + '|' + card.no); head.appendChild(q); }
    c.appendChild(head);
    var grid = el('div', 'grid' + (job.showArtist ? '' : ' title-only'));
    card.cells.forEach(function (sid) {
      var s = job.songs[sid] || { t: '?', a: '' };
      var f = job.fit[sid];
      var cell = el('div', 'cell' + (f.clamp ? ' clamp' : '')); cell.setAttribute('data-song', sid);
      var t = el('div', 't', s.t); t.style.fontSize = f.t + 'pt';
      cell.appendChild(t);
      if (job.showArtist && s.a) { var a = el('div', 'a', s.a); a.style.fontSize = f.a + 'pt'; cell.appendChild(a); }
      if (f.warn === 'too-long') cell.setAttribute('data-warn', '1');
      grid.appendChild(cell);
    });
    c.appendChild(grid);
    var foot = el('div', 'foot');
    var CKP = job.mode === 'checklist' && job.checklist && job.checklist.length;
    var LG = CKP ? job.checklist : job.rounds;
    var legend = el('div', 'legend' + (LG.length > 3 ? ' many' : ''));
    legend.appendChild(el('div', 'lg-title', CKP ? 'WINNING RULES · ANY ORDER' : 'WINNING PATTERNS'));
    var names = { 1: 'One Line', 2: 'Two Parallel Lines', 3: 'Full House' };
    var sub = { 1: 'any row or column', 2: '2 rows or 2 columns', 3: 'all 25 songs' };
    var std = { 1: 'ONE LINE', 2: 'TWO PARALLEL LINES', 3: 'FULL HOUSE' };
    if (CKP) job.checklist.forEach(function (r) {
      var b = el('div', 'lg-round');
      b.innerHTML = patternSvg(r.pattern) + '<div><b></b><span></span></div>';
      b.querySelector('b').textContent = r.label.charAt(0) + r.label.slice(1).toLowerCase();
      b.querySelector('span').textContent = r.short || '';
      legend.appendChild(b);
    });
    else job.rounds.forEach(function (r) {
      var b = el('div', 'lg-round');
      var custom = r.label && r.label !== std[r.n];
      var title = custom ? r.label.charAt(0) + r.label.slice(1).toLowerCase() : names[r.n];
      b.innerHTML = patternSvg(r.pattern) + '<div><b></b><span></span></div>';
      b.querySelector('b').textContent = 'Round ' + r.n + ': ' + title;
      b.querySelector('span').textContent = custom ? (r.short || '') : sub[r.n];
      legend.appendChild(b);
    });
    if (!LG.some(function (r) { return r.diagonals; })) legend.appendChild(el('div', 'lg-nodiag', 'No diagonal lines.'));
    foot.appendChild(legend);
    var small = el('div', 'small');
    small.appendChild(el('div', null, CKP ? 'No rounds · win any rule in any order · one card can win several rules · shout BINGO! and show this card' : 'Same card for all ' + job.rounds.length + ' round' + (job.rounds.length === 1 ? '' : 's') + ' · songs stay marked · shout BINGO! and show this card'));
    var right = el('div'); right.innerHTML = 'Card <b>' + pad(card.no) + '</b> · Batch ' + (card.batch || 1) + ' · Game ' + job.game.id;
    small.appendChild(right);
    if (job.footer) foot.appendChild(el('div', 'footmsg', job.footer));
    foot.appendChild(small);
    c.appendChild(foot);
    return c;
  }

  function build(job) {
    document.body.classList.toggle('bw', !!job.bw);
    ['inter', 'montserrat', 'classic', 'serif'].forEach(function (f) { document.body.classList.toggle('font-' + f, (job.font || 'inter') === f); });
    document.body.classList.toggle('no-cut', !job.cutLines);
    var scale = Math.max(0.8, Math.min(1.25, job.textScale || 1));
    if (!job.showArtist) document.getElementById('mcell').classList.add('title-only');
    job.fit = {}; var warnings = [], minFont = 99, broken = 0;
    Object.keys(job.songs).forEach(function (sid) {
      var f = fitSong(job.songs[sid].t, job.songs[sid].a, scale, job.showArtist);
      job.fit[sid] = f; minFont = Math.min(minFont, f.t);
      if (f.warn === 'too-long') warnings.push({ songId: sid, title: job.songs[sid].t, artist: job.songs[sid].a });
      if (f.warn === 'word-break') broken++;
    });
    var pages = document.getElementById('pages');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < job.cards.length; i += 2) {
      var sheet = el('div', 'sheet'); sheet.setAttribute('data-page', i / 2 + 1);
      var top = el('div', 'half top'); top.appendChild(buildCard(job, job.cards[i])); sheet.appendChild(top);
      if (job.cards[i + 1]) { var bot = el('div', 'half bottom'); bot.appendChild(buildCard(job, job.cards[i + 1])); sheet.appendChild(bot); }
      var cut = el('div', 'cut'); cut.appendChild(el('span', null, '✂  CUT HERE')); sheet.appendChild(cut);
      frag.appendChild(sheet);
    }
    pages.appendChild(frag);
    document.getElementById('measure').remove();
    // Verify every square in the real layout. Any that still overflows is shrunk in place;
    // if it can't fit at the minimum readable size it is flagged and reported by title.
    var warned = {}; warnings.forEach(function (w) { warned[w.songId] = 1; });
    pages.querySelectorAll('.cell').forEach(function (c) {
      if (c.classList.contains('clamp') || fits(c)) return;
      var t = c.querySelector('.t'), a = c.querySelector('.a'); var ts = parseFloat(t.style.fontSize), as = a ? parseFloat(a.style.fontSize) : 0;
      while (!fits(c) && ts > TITLE_MIN * scale * 0.9) { ts -= 0.25; t.style.fontSize = ts + 'pt'; if (a) { as = Math.max(ARTIST_MIN * scale * 0.9, as - 0.2); a.style.fontSize = as + 'pt'; } }
      if (!fits(c)) {
        c.classList.add('clamp'); c.setAttribute('data-warn', '1');
        var sid = c.getAttribute('data-song');
        if (!warned[sid]) { warned[sid] = 1; warnings.push({ songId: sid, title: job.songs[sid].t, artist: job.songs[sid].a }); }
      }
    });
    return { overflow: warnings.length, warnings: warnings, wordBreaks: broken, minFont: Math.round(minFont * 10) / 10, sheets: pages.children.length };
  }

  /* --------------------------------------------------------------- preview UI */
  function previewUi(job, info) {
    document.body.classList.add('preview');
    var bar = el('div', 'pv-bar');
    bar.innerHTML =
      '<div class="pv-brand"><img src="../shared/brand/icon-small.svg" alt=""><span>ANTHEM</span> <b>SQUARE</b> · Print preview</div>' +
      '<div class="pv-grp"><button id="pvPrev" title="Previous page">◀</button><span id="pvPage">Page 1 / ' + info.sheets + '</span><button id="pvNext" title="Next page">▶</button></div>' +
      '<div class="pv-grp"><button id="pvOut" title="Zoom out">−</button><span id="pvZoom">100%</span><button id="pvIn" title="Zoom in">+</button><button id="pvFit">Fit</button></div>' +
      '<div class="pv-grp"><input id="pvFind" inputmode="numeric" placeholder="Card #" maxlength="3"><button id="pvGo">Find</button></div>' +
      '<div class="pv-grp"><button id="pvQr">Check QR codes</button></div>' +
      '<span class="pv-grow"></span>' +
      '<div class="pv-grp"><button id="pvPrintAll" class="pri">🖨 Print all</button><input id="pvRange" placeholder="e.g. 1-50, 75"><button id="pvPrintRange">Print range</button><input id="pvRe" inputmode="numeric" placeholder="Card #" maxlength="3"><button id="pvReprint">Reprint card</button><button id="pvPdf">Export PDF</button></div>';
    var headWrap = el('div', 'pv-head'); headWrap.appendChild(bar);
    document.body.insertBefore(headWrap, document.body.firstChild);
    var status = el('div', 'pv-status');
    status.innerHTML = '<span>' + job.cards.length + ' card' + (job.cards.length === 1 ? '' : 's') + ' · ' + info.sheets + ' A4 sheet' + (info.sheets === 1 ? '' : 's') + ' · two per page</span>' +
      (job.locked ? '<span class="pv-ok">🔒 Cards locked — reprints are identical</span>' : '<span class="pv-warn">DRAFT — printing or exporting will lock these cards</span>') +
      (info.warnings.length ? '<span class="pv-bad">⚠ ' + info.warnings.length + ' title(s) too long to print in full: ' + info.warnings.slice(0, 5).map(function (w) { return w.title; }).join(', ') + (info.warnings.length > 5 ? '…' : '') + ' — set a shorter “Printed title” in the Music Library</span>' : '<span class="pv-ok">✓ All song text fits</span>') +
      '<span id="pvQrRes"></span>';
    headWrap.appendChild(status);

    var pages = document.getElementById('pages'); var zoom = 1;
    var sheets = Array.prototype.slice.call(pages.querySelectorAll('.sheet'));
    function setZoom(z) { zoom = Math.max(0.3, Math.min(2.5, z)); pages.style.zoom = zoom; document.getElementById('pvZoom').textContent = Math.round(zoom * 100) + '%'; }
    function fit() { var w = window.innerWidth - 60; setZoom(Math.min(1.4, w / (210 * 96 / 25.4))); }
    function current() { var mid = window.scrollY + window.innerHeight / 3; var n = 1; sheets.forEach(function (s, i) { if (s.getBoundingClientRect().top + window.scrollY <= mid) n = i + 1; }); return n; }
    function goPage(n) { n = Math.max(1, Math.min(sheets.length, n)); sheets[n - 1].scrollIntoView({ block: 'start' }); window.scrollBy(0, -headWrap.offsetHeight - 10); }
    function updatePage() { document.getElementById('pvPage').textContent = 'Page ' + current() + ' / ' + sheets.length; }
    window.addEventListener('scroll', updatePage);
    document.getElementById('pvPrev').onclick = function () { goPage(current() - 1); };
    document.getElementById('pvNext').onclick = function () { goPage(current() + 1); };
    document.getElementById('pvIn').onclick = function () { setZoom(zoom + 0.15); };
    document.getElementById('pvOut').onclick = function () { setZoom(zoom - 0.15); };
    document.getElementById('pvFit').onclick = fit;
    function find() {
      var n = parseInt(document.getElementById('pvFind').value, 10);
      var card = pages.querySelector('.card[data-card="' + n + '"]');
      if (!card) { flash('Card ' + (n || '?') + ' is not in this preview', true); return; }
      card.scrollIntoView({ block: 'center' });
      card.classList.remove('hl'); void card.offsetWidth; card.classList.add('hl');
    }
    document.getElementById('pvGo').onclick = find;
    document.getElementById('pvFind').onkeydown = function (e) { if (e.key === 'Enter') find(); };
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight') { goPage(current() + 1); e.preventDefault(); }
      if (e.key === 'PageUp' || e.key === 'ArrowLeft') { goPage(current() - 1); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') setZoom(zoom + 0.15);
      if (e.key === '-') setZoom(zoom - 0.15);
    });
    function flash(msg, bad) { var r = document.getElementById('pvQrRes'); r.className = bad ? 'pv-bad' : 'pv-ok'; r.textContent = msg; }

    // Decode every QR code on the pages and compare it with the card it's printed on
    document.getElementById('pvQr').onclick = function () {
      var qrs = Array.prototype.slice.call(pages.querySelectorAll('.qr'));
      if (!qrs.length) { flash('QR codes are switched off for this print', true); return; }
      if (!window.jsQR) { flash('QR checker not available', true); return; }
      var ok = 0, bad = []; var i = 0; var cv = document.createElement('canvas'); cv.width = cv.height = 240; var ctx = cv.getContext('2d', { willReadFrequently: true });
      (function next() {
        if (i >= qrs.length) { if (bad.length) flash('⚠ ' + bad.length + ' QR code(s) did not match: cards ' + bad.slice(0, 8).join(', '), true); else flash('✓ All ' + ok + ' QR codes scanned and match their card numbers'); return; }
        var q = qrs[i++]; var svg = q.querySelector('svg'); var expect = q.getAttribute('data-expect');
        var x = new XMLSerializer().serializeToString(svg);
        var img = new Image();
        img.onload = function () {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 240, 240); ctx.drawImage(img, 20, 20, 200, 200);
          var d = ctx.getImageData(0, 0, 240, 240); var code = window.jsQR(d.data, 240, 240);
          if (code && code.data === expect) ok++; else bad.push(expect.split('|')[2]);
          if (i % 25 === 0) flash('Checking QR codes… ' + i + ' / ' + qrs.length);
          setTimeout(next, 0);
        };
        img.onerror = function () { bad.push(expect.split('|')[2]); setTimeout(next, 0); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(x);
      })();
    };
    window.__checkQr = function () { return new Promise(function (res) { document.getElementById('pvQr').click(); var t = setInterval(function () { var r = document.getElementById('pvQrRes').textContent; if (/match/.test(r)) { clearInterval(t); res(r); } }, 200); }); };

    // Printing / export reuse the laptop's normal print pipeline (same saved cards).
    function lockConfirm() {
      if (job.locked) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var m = el('div', 'pv-modal');
        m.innerHTML = '<div class="pv-box"><h2>LOCK BINGO CARDS?</h2><p><b>Once these cards have been issued, their songs and arrangements cannot be changed. This ensures printed cards always match Bingo verification.</b></p><div class="pv-btns"><button id="pvLockNo">Cancel</button><button id="pvLockYes" class="pri">🔒 Confirm &amp; Lock</button></div></div>';
        document.body.appendChild(m);
        m.querySelector('#pvLockNo').onclick = function () { m.remove(); resolve(false); };
        m.querySelector('#pvLockYes').onclick = function () { m.remove(); resolve(true); };
      });
    }
    function act(kind, range) {
      lockConfirm().then(function (ok) {
        if (!ok) return;
        var args = Object.assign({ id: job.gameKey, confirmLock: true, range: range || null }, job.opts);
        flash(kind === 'pdf' ? 'Creating PDF…' : 'Opening the print dialog…');
        window.cmb.invoke(kind === 'pdf' ? 'cards:exportPdf' : 'cards:print', args).then(function (r) {
          if (!r) { flash('Cancelled'); return; }
          job.locked = true;
          document.querySelector('.pv-warn') && (document.querySelector('.pv-warn').outerHTML = '<span class="pv-ok">🔒 Cards locked — reprints are identical</span>');
          if (kind === 'pdf') flash('✓ PDF saved: ' + r.file);
          else flash(r.printed ? '✓ Sent ' + r.sheets + ' sheet(s) to the printer' : 'Printing cancelled', !r.printed);
        }).catch(function (e) { flash(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); });
      });
    }
    document.getElementById('pvPrintAll').onclick = function () { act('print', job.cards.map(function (c) { return c.no; }).join(',')); };
    document.getElementById('pvPrintRange').onclick = function () { var r = document.getElementById('pvRange').value.trim(); if (!r) return flash('Type a range such as 1-50, 75', true); act('print', r); };
    document.getElementById('pvReprint').onclick = function () { var n = parseInt(document.getElementById('pvRe').value, 10); if (!n) return flash('Type the card number to reprint', true); act('print', String(n)); };
    document.getElementById('pvPdf').onclick = function () { act('pdf', job.cards.map(function (c) { return c.no; }).join(',')); };
    fit(); updatePage();
  }

  window.cmb.on('print:job', function (job) {
    var fl = document.fonts ? Promise.all(['400 10pt Inter', '600 10pt Inter', '800 10pt Inter', '10pt Anton'].map(function (f) { return document.fonts.load(f, 'AaBb'); })).catch(function () {}) : Promise.resolve();
    fl.then(function () { return document.fonts ? document.fonts.ready : null; }).then(function () {
      var info = build(job);
      if (PREVIEW || job.preview) previewUi(job, info);
      if (job.images) {
        document.body.classList.add('images');
        // one card at a time, top-left, for a pixel-exact capture of that card
        window.__showCard = function (no) {
          document.querySelectorAll('.half.show').forEach(function (h) { h.classList.remove('show'); });
          var c = document.querySelector('.card[data-card="' + no + '"]');
          if (c) c.closest('.half').classList.add('show');
          window.scrollTo(0, 0);
          return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () { res(!!c); }, 60); }); }); });
        };
      }
      requestAnimationFrame(function () { window.cmb.send('print:ready', info); });
    });
  });
})();
