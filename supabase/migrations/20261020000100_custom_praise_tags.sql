-- W25 / REQ-003, REQ-007 / POL-PRAISE-001, POL-PRAISE-002 / TC-PRAISE-TAG-002.
-- Unicode 17.0 ranges generated with Node 24.19.0 L/M/N properties.
begin;
grant create on schema public, private to chagokchan_rpc;
create function private.legacy_praise_tags(p_tag text) returns text[]
language sql immutable set search_path = pg_catalog as $$
  select case p_tag when 'consistency' then array['꾸준함'] when 'courage' then array['용기']
    when 'care' then array['배려'] when 'growth' then array['성장'] when 'rest' then array['쉼'] else '{}'::text[] end;
$$;
create function private.legacy_praise_tag(p_tags text[]) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when cardinality(p_tags)=1 then case p_tags[1] when '꾸준함' then 'consistency' when '용기' then 'courage'
    when '배려' then 'care' when '성장' then 'growth' when '쉼' then 'rest' end end;
$$;
create function private.normalize_praise_tags(p_tags text[]) returns text[]
language plpgsql immutable set search_path = pg_catalog as $normalize_tags$
declare item text; normalized text; identity_key text; identities text[] := '{}'; result text[] := '{}';
begin
  if p_tags is null or cardinality(p_tags)>5 or (cardinality(p_tags)>0 and (array_ndims(p_tags)<>1 or array_lower(p_tags,1)<>1)) then
    raise exception using errcode='PT400', message='invalid_praise_input';
  end if;
  foreach item in array p_tags loop
    normalized := normalize(item, NFC);
    if normalized is null or char_length(normalized) not between 1 and 20 or
       normalized !~ $tagchars$^[0-9A-Za-zª²-³µ¹-º¼-¾À-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮ̀-ʹͶ-ͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁ҃-ԯԱ-Ֆՙՠ-ֈ֑-ֽֿׁ-ׂׄ-ׇׅא-תׯ-ײؐ-ؚؠ-٩ٮ-ۓە-ۜ۟-۪ۨ-ۼۿܐ-݊ݍ-ޱ߀-ߵߺ߽ࠀ-࠭ࡀ-࡛ࡠ-ࡪࡰ-ࢇࢉ-࢏ࢗ-ࣣ࣡-ॣ०-९ॱ-ঃঅ-ঌএ-ঐও-নপ-রলশ-হ়-ৄে-ৈো-ৎৗড়-ঢ়য়-ৣ০-ৱ৴-৹ৼ৾ਁ-ਃਅ-ਊਏ-ਐਓ-ਨਪ-ਰਲ-ਲ਼ਵ-ਸ਼ਸ-ਹ਼ਾ-ੂੇ-ੈੋ-੍ੑਖ਼-ੜਫ਼੦-ੵઁ-ઃઅ-ઍએ-ઑઓ-નપ-રલ-ળવ-હ઼-ૅે-ૉો-્ૐૠ-ૣ૦-૯ૹ-૿ଁ-ଃଅ-ଌଏ-ଐଓ-ନପ-ରଲ-ଳଵ-ହ଼-ୄେ-ୈୋ-୍୕-ୗଡ଼-ଢ଼ୟ-ୣ୦-୯ୱ-୷ஂ-ஃஅ-ஊஎ-ஐஒ-கங-சஜஞ-டண-தந-பம-ஹா-ூெ-ைொ-்ௐௗ௦-௲ఀ-ఌఎ-ఐఒ-నప-హ఼-ౄె-ైొ-్ౕ-ౖౘ-ౚ౜-ౝౠ-ౣ౦-౯౸-౾ಀ-ಃಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹ಼-ೄೆ-ೈೊ-್ೕ-ೖ೜-ೞೠ-ೣ೦-೯ೱ-ೳഀ-ഌഎ-ഐഒ-ൄെ-ൈൊ-ൎൔ-ൣ൦-൸ൺ-ൿඁ-ඃඅ-ඖක-නඳ-රලව-ෆ්ා-ුූෘ-ෟ෦-෯ෲ-ෳก-ฺเ-๎๐-๙ກ-ຂຄຆ-ຊຌ-ຣລວ-ຽເ-ໄໆ່-໎໐-໙ໜ-ໟༀ༘-༙༠-༳༹༵༷༾-ཇཉ-ཬཱ-྄྆-ྗྙ-ྼ࿆က-၉ၐ-ႝႠ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚ፝-፟፩-፼ᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛮ-ᛸᜀ-᜕ᜟ-᜴ᝀ-ᝓᝠ-ᝬᝮ-ᝰᝲ-ᝳក-៓ៗៜ-៝០-៩៰-៹᠋-᠍᠏-᠙ᠠ-ᡸᢀ-ᢪᢰ-ᣵᤀ-ᤞᤠ-ᤫᤰ-᤻᥆-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉ᧐-᧚ᨀ-ᨛᨠ-ᩞ᩠-᩿᩼-᪉᪐-᪙ᪧ᪰-᫝᫠-᫫ᬀ-ᭌ᭐-᭙᭫-᭳ᮀ-᯳ᰀ-᰷᱀-᱉ᱍ-ᱽᲀ-ᲊᲐ-ᲺᲽ-Ჿ᳐-᳔᳒-ᳺᴀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼ⁰-ⁱ⁴-⁹ⁿ-₉ₐ-ₜ⃐-⃰ℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℹℼ-ℿⅅ-ⅉⅎ⅐-↉①-⒛⓪-⓿❶-➓Ⰰ-ⳤⳫ-ⳳ⳽ⴀ-ⴥⴧⴭⴰ-ⵧⵯ⵿-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞⷠ-ⷿⸯ々-〇〡-〯〱-〵〸-〼ぁ-ゖ゙-゚ゝ-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎ㆒-㆕ㆠ-ㆿㇰ-ㇿ㈠-㈩㉈-㉏㉑-㉟㊀-㊉㊱-㊿㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘫꙀ-꙲ꙴ-꙽ꙿ-꛱ꜗ-ꜟꜢ-ꞈꞋ-Ƛ꟱-ꠧ꠬꠰-꠵ꡀ-ꡳꢀ-ꣅ꣐-꣙꣠-ꣷꣻꣽ-꤭ꤰ-꥓ꥠ-ꥼꦀ-꧀ꧏ-꧙ꧠ-ꧾꨀ-ꨶꩀ-ꩍ꩐-꩙ꩠ-ꩶꩺ-ꫂꫛ-ꫝꫠ-ꫯꫲ-꫶ꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯪ꯬-꯭꯰-꯹가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִ-ﬨשׁ-זּטּ-לּמּנּ-סּףּ-פּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻ︀-️︠-︯ﹰ-ﹴﹶ-ﻼ０-９Ａ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ𐀀-𐀋𐀍-𐀦𐀨-𐀺𐀼-𐀽𐀿-𐁍𐁐-𐁝𐂀-𐃺𐄇-𐄳𐅀-𐅸𐆊-𐆋𐇽𐊀-𐊜𐊠-𐋐𐋠-𐋻𐌀-𐌣𐌭-𐍊𐍐-𐍺𐎀-𐎝𐎠-𐏃𐏈-𐏏𐏑-𐏕𐐀-𐒝𐒠-𐒩𐒰-𐓓𐓘-𐓻𐔀-𐔧𐔰-𐕣𐕰-𐕺𐕼-𐖊𐖌-𐖒𐖔-𐖕𐖗-𐖡𐖣-𐖱𐖳-𐖹𐖻-𐖼𐗀-𐗳𐘀-𐜶𐝀-𐝕𐝠-𐝧𐞀-𐞅𐞇-𐞰𐞲-𐞺𐠀-𐠅𐠈𐠊-𐠵𐠷-𐠸𐠼𐠿-𐡕𐡘-𐡶𐡹-𐢞𐢧-𐢯𐣠-𐣲𐣴-𐣵𐣻-𐤛𐤠-𐤹𐥀-𐥙𐦀-𐦷𐦼-𐧏𐧒-𐨃𐨅-𐨆𐨌-𐨓𐨕-𐨗𐨙-𐨵𐨸-𐨿𐨺-𐩈𐩠-𐩾𐪀-𐪟𐫀-𐫇𐫉-𐫦𐫫-𐫯𐬀-𐬵𐭀-𐭕𐭘-𐭲𐭸-𐮑𐮩-𐮯𐰀-𐱈𐲀-𐲲𐳀-𐳲𐳺-𐴧𐴰-𐴹𐵀-𐵥𐵩-𐵭𐵯-𐶅𐹠-𐹾𐺀-𐺩𐺫-𐺬𐺰-𐺱𐻂-𐻇𐻺-𐼧𐼰-𐽔𐽰-𐾅𐾰-𐿋𐿠-𐿶𑀀-𑁆𑁒-𑁵𑁿-𑂺𑃂𑃐-𑃨𑃰-𑃹𑄀-𑄴𑄶-𑄿𑅄-𑅇𑅐-𑅳𑅶𑆀-𑇄𑇉-𑇌𑇎-𑇚𑇜𑇡-𑇴𑈀-𑈑𑈓-𑈷𑈾-𑉁𑊀-𑊆𑊈𑊊-𑊍𑊏-𑊝𑊟-𑊨𑊰-𑋪𑋰-𑋹𑌀-𑌃𑌅-𑌌𑌏-𑌐𑌓-𑌨𑌪-𑌰𑌲-𑌳𑌵-𑌹𑌻-𑍄𑍇-𑍈𑍋-𑍍𑍐𑍗𑍝-𑍣𑍦-𑍬𑍰-𑍴𑎀-𑎉𑎋𑎎𑎐-𑎵𑎷-𑏀𑏅𑏅𑎸-𑏊𑏌-𑏓𑏡-𑏢𑐀-𑑊𑑐-𑑙𑑞-𑑡𑒀-𑓅𑓇𑓐-𑓙𑖀-𑖵𑖸-𑗀𑗘-𑗝𑘀-𑙀𑙄𑙐-𑙙𑚀-𑚸𑛀-𑛉𑛐-𑛣𑜀-𑜚𑜝-𑜫𑜰-𑜻𑝀-𑝆𑠀-𑠺𑢠-𑣲𑣿-𑤆𑤉𑤌-𑤓𑤕-𑤖𑤘-𑤵𑤷-𑤸𑤻-𑥃𑥐-𑥙𑦠-𑦧𑦪-𑧗𑧚-𑧡𑧣-𑧤𑨀-𑨾𑩇𑩐-𑪙𑪝𑪰-𑫸𑭠-𑭧𑯀-𑯠𑯰-𑯹𑰀-𑰈𑰊-𑰶𑰸-𑱀𑱐-𑱬𑱲-𑲏𑲒-𑲧𑲩-𑲶𑴀-𑴆𑴈-𑴉𑴋-𑴶𑴺𑴼-𑴽𑴿-𑵇𑵐-𑵙𑵠-𑵥𑵧-𑵨𑵪-𑶎𑶐-𑶑𑶓-𑶘𑶠-𑶩𑶰-𑷛𑷠-𑷩𑻠-𑻶𑼀-𑼐𑼒-𑼺𑼾-𑽂𑽐-𑽚𑾰𑿀-𑿔𒀀-𒎙𒐀-𒑮𒒀-𒕃𒾐-𒿰𓀀-𓐯𓑀-𓑕𓑠-𔏺𔐀-𔙆𖄀-𖄹𖠀-𖨸𖩀-𖩞𖩠-𖩩𖩰-𖪾𖫀-𖫉𖫐-𖫭𖫰-𖫴𖬀-𖬶𖭀-𖭃𖭐-𖭙𖭛-𖭡𖭣-𖭷𖭽-𖮏𖵀-𖵬𖵰-𖵹𖹀-𖺖𖺠-𖺸𖺻-𖻓𖼀-𖽊𖽏-𖾇𖾏-𖾟𖿠-𖿡𖿣-𖿤𖿰-𖿶𗀀-𘳕𘳿-𘴞𘶀-𘷲𚿰-𚿳𚿵-𚿻𚿽-𚿾𛀀-𛄢𛄲𛅐-𛅒𛅕𛅤-𛅧𛅰-𛋻𛰀-𛱪𛱰-𛱼𛲀-𛲈𛲐-𛲙𛲝-𛲞𜳰-𜳹𜼀-𜼭𜼰-𜽆𝅥-𝅩𝅭-𝅲𝅻-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝋀-𝋓𝋠-𝋳𝍠-𝍸𝐀-𝑔𝑖-𝒜𝒞-𝒟𝒢𝒥-𝒦𝒩-𝒬𝒮-𝒹𝒻𝒽-𝓃𝓅-𝔅𝔇-𝔊𝔍-𝔔𝔖-𝔜𝔞-𝔹𝔻-𝔾𝕀-𝕄𝕆𝕊-𝕐𝕒-𝚥𝚨-𝛀𝛂-𝛚𝛜-𝛺𝛼-𝜔𝜖-𝜴𝜶-𝝎𝝐-𝝮𝝰-𝞈𝞊-𝞨𝞪-𝟂𝟄-𝟋𝟎-𝟿𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𝼀-𝼞𝼥-𝼪𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞀰-𞁭𞂏𞄀-𞄬𞄰-𞄽𞅀-𞅉𞅎𞊐-𞊮𞋀-𞋹𞓐-𞓹𞗐-𞗺𞛀-𞛞𞛠-𞛵𞛾-𞛿𞟠-𞟦𞟨-𞟫𞟭-𞟮𞟰-𞟾𞠀-𞣄𞣇-𞣖𞤀-𞥋𞥐-𞥙𞱱-𞲫𞲭-𞲯𞲱-𞲴𞴁-𞴭𞴯-𞴽𞸀-𞸃𞸅-𞸟𞸡-𞸢𞸤𞸧𞸩-𞸲𞸴-𞸷𞸹𞸻𞹂𞹇𞹉𞹋𞹍-𞹏𞹑-𞹒𞹔𞹗𞹙𞹛𞹝𞹟𞹡-𞹢𞹤𞹧-𞹪𞹬-𞹲𞹴-𞹷𞹹-𞹼𞹾𞺀-𞺉𞺋-𞺛𞺡-𞺣𞺥-𞺩𞺫-𞺻🄀-🄌🯰-🯹𠀀-𪛟𪜀-𫠝𫠠-𬺭𬺰-𮯠𮯰-𮹝丽-𪘀𰀀-𱍊𱍐-𳑹󠄀-󠇯_-]+$$tagchars$ or normalized !~ $tagbody$[0-9A-Za-zª²-³µ¹-º¼-¾À-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮͰ-ʹͶ-ͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՙՠ-ֈא-תׯ-ײؠ-ي٠-٩ٮ-ٯٱ-ۓەۥ-ۦۮ-ۼۿܐܒ-ܯݍ-ޥޱ߀-ߪߴ-ߵߺࠀ-ࠕࠚࠤࠨࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-࢏ࢠ-ࣉऄ-हऽॐक़-ॡ०-९ॱ-ঀঅ-ঌএ-ঐও-নপ-রলশ-হঽৎড়-ঢ়য়-ৡ০-ৱ৴-৹ৼਅ-ਊਏ-ਐਓ-ਨਪ-ਰਲ-ਲ਼ਵ-ਸ਼ਸ-ਹਖ਼-ੜਫ਼੦-੯ੲ-ੴઅ-ઍએ-ઑઓ-નપ-રલ-ળવ-હઽૐૠ-ૡ૦-૯ૹଅ-ଌଏ-ଐଓ-ନପ-ରଲ-ଳଵ-ହଽଡ଼-ଢ଼ୟ-ୡ୦-୯ୱ-୷ஃஅ-ஊஎ-ஐஒ-கங-சஜஞ-டண-தந-பம-ஹௐ௦-௲అ-ఌఎ-ఐఒ-నప-హఽౘ-ౚ౜-ౝౠ-ౡ౦-౯౸-౾ಀಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽ೜-ೞೠ-ೡ೦-೯ೱ-ೲഄ-ഌഎ-ഐഒ-ഺഽൎൔ-ൖ൘-ൡ൦-൸ൺ-ൿඅ-ඖක-නඳ-රලව-ෆ෦-෯ก-ะา-ำเ-ๆ๐-๙ກ-ຂຄຆ-ຊຌ-ຣລວ-ະາ-ຳຽເ-ໄໆ໐-໙ໜ-ໟༀ༠-༳ཀ-ཇཉ-ཬྈ-ྌက-ဪဿ-၉ၐ-ၕၚ-ၝၡၥ-ၦၮ-ၰၵ-ႁႎ႐-႙Ⴀ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚ፩-፼ᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛮ-ᛸᜀ-ᜑᜟ-ᜱᝀ-ᝑᝠ-ᝬᝮ-ᝰក-ឳៗៜ០-៩៰-៹᠐-᠙ᠠ-ᡸᢀ-ᢄᢇ-ᢨᢪᢰ-ᣵᤀ-ᤞ᥆-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉ᧐-᧚ᨀ-ᨖᨠ-ᩔ᪀-᪉᪐-᪙ᪧᬅ-ᬳᭅ-ᭌ᭐-᭙ᮃ-ᮠᮮ-ᯥᰀ-ᰣ᱀-᱉ᱍ-ᱽᲀ-ᲊᲐ-ᲺᲽ-Ჿᳩ-ᳬᳮ-ᳳᳵ-ᳶᳺᴀ-ᶿḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼ⁰-ⁱ⁴-⁹ⁿ-₉ₐ-ₜℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℹℼ-ℿⅅ-ⅉⅎ⅐-↉①-⒛⓪-⓿❶-➓Ⰰ-ⳤⳫ-ⳮⳲ-ⳳ⳽ⴀ-ⴥⴧⴭⴰ-ⵧⵯⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞⸯ々-〇〡-〩〱-〵〸-〼ぁ-ゖゝ-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎ㆒-㆕ㆠ-ㆿㇰ-ㇿ㈠-㈩㉈-㉏㉑-㉟㊀-㊉㊱-㊿㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘫꙀ-ꙮꙿ-ꚝꚠ-ꛯꜗ-ꜟꜢ-ꞈꞋ-Ƛ꟱-ꠁꠃ-ꠅꠇ-ꠊꠌ-ꠢ꠰-꠵ꡀ-ꡳꢂ-ꢳ꣐-꣙ꣲ-ꣷꣻꣽ-ꣾ꤀-ꤥꤰ-ꥆꥠ-ꥼꦄ-ꦲꧏ-꧙ꧠ-ꧤꧦ-ꧾꨀ-ꨨꩀ-ꩂꩄ-ꩋ꩐-꩙ꩠ-ꩶꩺꩾ-ꪯꪱꪵ-ꪶꪹ-ꪽꫀꫂꫛ-ꫝꫠ-ꫪꫲ-ꫴꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯢ꯰-꯹가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִײַ-ﬨשׁ-זּטּ-לּמּנּ-סּףּ-פּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼ０-９Ａ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ𐀀-𐀋𐀍-𐀦𐀨-𐀺𐀼-𐀽𐀿-𐁍𐁐-𐁝𐂀-𐃺𐄇-𐄳𐅀-𐅸𐆊-𐆋𐊀-𐊜𐊠-𐋐𐋡-𐋻𐌀-𐌣𐌭-𐍊𐍐-𐍵𐎀-𐎝𐎠-𐏃𐏈-𐏏𐏑-𐏕𐐀-𐒝𐒠-𐒩𐒰-𐓓𐓘-𐓻𐔀-𐔧𐔰-𐕣𐕰-𐕺𐕼-𐖊𐖌-𐖒𐖔-𐖕𐖗-𐖡𐖣-𐖱𐖳-𐖹𐖻-𐖼𐗀-𐗳𐘀-𐜶𐝀-𐝕𐝠-𐝧𐞀-𐞅𐞇-𐞰𐞲-𐞺𐠀-𐠅𐠈𐠊-𐠵𐠷-𐠸𐠼𐠿-𐡕𐡘-𐡶𐡹-𐢞𐢧-𐢯𐣠-𐣲𐣴-𐣵𐣻-𐤛𐤠-𐤹𐥀-𐥙𐦀-𐦷𐦼-𐧏𐧒-𐨀𐨐-𐨓𐨕-𐨗𐨙-𐨵𐩀-𐩈𐩠-𐩾𐪀-𐪟𐫀-𐫇𐫉-𐫤𐫫-𐫯𐬀-𐬵𐭀-𐭕𐭘-𐭲𐭸-𐮑𐮩-𐮯𐰀-𐱈𐲀-𐲲𐳀-𐳲𐳺-𐴣𐴰-𐴹𐵀-𐵥𐵯-𐶅𐹠-𐹾𐺀-𐺩𐺰-𐺱𐻂-𐻇𐼀-𐼧𐼰-𐽅𐽑-𐽔𐽰-𐾁𐾰-𐿋𐿠-𐿶𑀃-𑀷𑁒-𑁯𑁱-𑁲𑁵𑂃-𑂯𑃐-𑃨𑃰-𑃹𑄃-𑄦𑄶-𑄿𑅄𑅇𑅐-𑅲𑅶𑆃-𑆲𑇁-𑇄𑇐-𑇚𑇜𑇡-𑇴𑈀-𑈑𑈓-𑈫𑈿-𑉀𑊀-𑊆𑊈𑊊-𑊍𑊏-𑊝𑊟-𑊨𑊰-𑋞𑋰-𑋹𑌅-𑌌𑌏-𑌐𑌓-𑌨𑌪-𑌰𑌲-𑌳𑌵-𑌹𑌽𑍐𑍝-𑍡𑎀-𑎉𑎋𑎎𑎐-𑎵𑎷𑏑𑏓𑐀-𑐴𑑇-𑑊𑑐-𑑙𑑟-𑑡𑒀-𑒯𑓄-𑓅𑓇𑓐-𑓙𑖀-𑖮𑗘-𑗛𑘀-𑘯𑙄𑙐-𑙙𑚀-𑚪𑚸𑛀-𑛉𑛐-𑛣𑜀-𑜚𑜰-𑜻𑝀-𑝆𑠀-𑠫𑢠-𑣲𑣿-𑤆𑤉𑤌-𑤓𑤕-𑤖𑤘-𑤯𑤿𑥁𑥐-𑥙𑦠-𑦧𑦪-𑧐𑧡𑧣𑨀𑨋-𑨲𑨺𑩐𑩜-𑪉𑪝𑪰-𑫸𑯀-𑯠𑯰-𑯹𑰀-𑰈𑰊-𑰮𑱀𑱐-𑱬𑱲-𑲏𑴀-𑴆𑴈-𑴉𑴋-𑴰𑵆𑵐-𑵙𑵠-𑵥𑵧-𑵨𑵪-𑶉𑶘𑶠-𑶩𑶰-𑷛𑷠-𑷩𑻠-𑻲𑼂𑼄-𑼐𑼒-𑼳𑽐-𑽙𑾰𑿀-𑿔𒀀-𒎙𒐀-𒑮𒒀-𒕃𒾐-𒿰𓀀-𓐯𓑁-𓑆𓑠-𔏺𔐀-𔙆𖄀-𖄝𖄰-𖄹𖠀-𖨸𖩀-𖩞𖩠-𖩩𖩰-𖪾𖫀-𖫉𖫐-𖫭𖬀-𖬯𖭀-𖭃𖭐-𖭙𖭛-𖭡𖭣-𖭷𖭽-𖮏𖵀-𖵬𖵰-𖵹𖹀-𖺖𖺠-𖺸𖺻-𖻓𖼀-𖽊𖽐𖾓-𖾟𖿠-𖿡𖿣𖿲-𖿶𗀀-𘳕𘳿-𘴞𘶀-𘷲𚿰-𚿳𚿵-𚿻𚿽-𚿾𛀀-𛄢𛄲𛅐-𛅒𛅕𛅤-𛅧𛅰-𛋻𛰀-𛱪𛱰-𛱼𛲀-𛲈𛲐-𛲙𜳰-𜳹𝋀-𝋓𝋠-𝋳𝍠-𝍸𝐀-𝑔𝑖-𝒜𝒞-𝒟𝒢𝒥-𝒦𝒩-𝒬𝒮-𝒹𝒻𝒽-𝓃𝓅-𝔅𝔇-𝔊𝔍-𝔔𝔖-𝔜𝔞-𝔹𝔻-𝔾𝕀-𝕄𝕆𝕊-𝕐𝕒-𝚥𝚨-𝛀𝛂-𝛚𝛜-𝛺𝛼-𝜔𝜖-𝜴𝜶-𝝎𝝐-𝝮𝝰-𝞈𝞊-𝞨𝞪-𝟂𝟄-𝟋𝟎-𝟿𝼀-𝼞𝼥-𝼪𞀰-𞁭𞄀-𞄬𞄷-𞄽𞅀-𞅉𞅎𞊐-𞊭𞋀-𞋫𞋰-𞋹𞓐-𞓫𞓰-𞓹𞗐-𞗭𞗰-𞗺𞛀-𞛞𞛠-𞛢𞛤-𞛥𞛧-𞛭𞛰-𞛴𞛾-𞛿𞟠-𞟦𞟨-𞟫𞟭-𞟮𞟰-𞟾𞠀-𞣄𞣇-𞣏𞤀-𞥃𞥋𞥐-𞥙𞱱-𞲫𞲭-𞲯𞲱-𞲴𞴁-𞴭𞴯-𞴽𞸀-𞸃𞸅-𞸟𞸡-𞸢𞸤𞸧𞸩-𞸲𞸴-𞸷𞸹𞸻𞹂𞹇𞹉𞹋𞹍-𞹏𞹑-𞹒𞹔𞹗𞹙𞹛𞹝𞹟𞹡-𞹢𞹤𞹧-𞹪𞹬-𞹲𞹴-𞹷𞹹-𞹼𞹾𞺀-𞺉𞺋-𞺛𞺡-𞺣𞺥-𞺩𞺫-𞺻🄀-🄌🯰-🯹𠀀-𪛟𪜀-𫠝𫠠-𬺭𬺰-𮯠𮯰-𮹝丽-𪘀𰀀-𱍊𱍐-𳑹]$tagbody$ then
      raise exception using errcode='PT400', message='invalid_praise_input';
    end if;
    identity_key := translate(normalized,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
    if not identity_key=any(identities) then result := array_append(result,normalized); identities := array_append(identities,identity_key); end if;
  end loop;
  return result;
end $normalize_tags$;
alter function private.legacy_praise_tags(text) owner to chagokchan_rpc;
alter function private.legacy_praise_tag(text[]) owner to chagokchan_rpc;
alter function private.normalize_praise_tags(text[]) owner to chagokchan_rpc;
revoke all on function private.legacy_praise_tags(text), private.legacy_praise_tag(text[]), private.normalize_praise_tags(text[]) from public, anon, authenticated, service_role;

alter table public.praises add column tags text[] not null default '{}';
update public.praises set tags=private.legacy_praise_tags(tag);
alter table public.praises
  add constraint praises_tags_valid check (tags=private.normalize_praise_tags(tags)),
  add constraint praises_tags_legacy_projection check (tag is not distinct from private.legacy_praise_tag(tags)),
  add constraint praises_peer_no_tags check (source<>'peer' or tags='{}'::text[]),
  add constraint praises_cancel_clears_tags check (cancelled_at is null or tags='{}'::text[]);
grant select(tags), insert(tags), update(tags) on public.praises to chagokchan_rpc;
create or replace function private.create_self_praise_core(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tag text default null, p_tags text[] default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; actor_timezone text; now_at timestamptz := clock_timestamp(); utc_minute timestamptz; utc_day timestamptz;
  normalized_tags text[]; normalized_message text; request_hash text; canonical_input jsonb; praise_uuid uuid := gen_random_uuid();
  receipt_uuid uuid := gen_random_uuid(); inserted_receipt uuid; existing public.request_receipts%rowtype;
  board_row record; cycle_row record; cycle_uuid uuid; v_cycle_no integer; v_valid_count integer; completed_now boolean := false;
begin
  actor := private.require_actor();
  if p_request_key is null or p_board_id is null then raise exception using errcode = 'PT400', message = 'invalid_praise_input'; end if;
  if p_tag is not null and p_tag not in ('consistency', 'courage', 'care', 'growth', 'rest') then
    raise exception using errcode = 'PT400', message = 'invalid_praise_input';
  end if;
  normalized_tags := private.normalize_praise_tags(case when p_tags is null then private.legacy_praise_tags(p_tag) else p_tags end);
  normalized_message := case when p_message is null then null else
    nullif(normalize(replace(replace(p_message, E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
  if normalized_message is not null and char_length(normalized_message) > 1000 then
    raise exception using errcode = 'PT400', message = 'invalid_praise_input';
  end if;
  select timezone into actor_timezone from public.app_users where id = actor;
  if actor_timezone is null then raise exception using errcode = 'PT403', message = 'account_unavailable'; end if;
  if p_occurred_on is not null and (p_occurred_on > (now_at at time zone actor_timezone)::date or
     p_occurred_on < (now_at at time zone actor_timezone)::date - 365) then
    raise exception using errcode = 'PT400', message = 'occurred_on_out_of_range';
  end if;
  canonical_input := jsonb_build_object('board_id', p_board_id, 'message', normalized_message, 'occurred_on', p_occurred_on);
  -- Omit the null tag key to preserve hashes of requests created before W20-A.
  if p_tags is not null then canonical_input := canonical_input || jsonb_build_object('tags', normalized_tags);
  elsif p_tag is not null then canonical_input := canonical_input || jsonb_build_object('tag', p_tag); end if;
  request_hash := encode(sha256(convert_to(canonical_input::text, 'UTF8')), 'hex');
  insert into public.request_receipts(id, actor_user_id, operation, request_key, input_hash, result_kind, result_id)
    values (receipt_uuid, actor, 'createPraise', p_request_key, request_hash, 'praise', praise_uuid)
    on conflict (actor_user_id, operation, request_key) do nothing returning id into inserted_receipt;
  if inserted_receipt is null then
    select * into existing from public.request_receipts r
      where r.actor_user_id = actor and r.operation = 'createPraise' and r.request_key = p_request_key for update;
    if existing.input_hash is distinct from request_hash or existing.result_kind <> 'praise' then
      raise exception using errcode = 'PT409', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', existing.result_id, 'replayed', true);
  end if;

  select b.id, b.goal_id, b.owner_user_id, b.kind, b.next_target_count, b.next_rule_code, b.current_bunch_id,
    g.status as goal_status into board_row
    from public.boards b join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where b.id = p_board_id and b.owner_user_id = actor for update of g, b;
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if board_row.kind <> 'personal' then raise exception using errcode = 'PT403', message = 'board_access_denied'; end if;
  if board_row.goal_status <> 'active' then raise exception using errcode = 'PT409', message = 'goal_not_active'; end if;

  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  utc_day := date_trunc('day', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_write_minute', 20, utc_minute, utc_minute + interval '1 minute');
  perform private.consume_rate_limit(actor, 'praise_write_day', 300, utc_day, utc_day + interval '1 day');

  if board_row.current_bunch_id is null then
    v_cycle_no := 1;
    insert into public.bunches(board_id, cycle_no, target_count, rule_code)
      values (board_row.id, v_cycle_no, board_row.next_target_count, board_row.next_rule_code) returning id into cycle_uuid;
    update public.boards set current_bunch_id = cycle_uuid where id = board_row.id;
    select bu.id, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
      from public.bunches bu where bu.id = cycle_uuid;
  else
    select bu.id, bu.cycle_no, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
      from public.bunches bu where bu.id = board_row.current_bunch_id and bu.board_id = board_row.id for update;
    if not found then raise exception using errcode = 'PT503', message = 'current_bunch_incomplete'; end if;
    if cycle_row.progress_state = 'complete' then
      v_cycle_no := cycle_row.cycle_no + 1;
      insert into public.bunches(board_id, cycle_no, target_count, rule_code)
        values (board_row.id, v_cycle_no, board_row.next_target_count, board_row.next_rule_code) returning id into cycle_uuid;
      update public.boards set current_bunch_id = cycle_uuid where id = board_row.id;
      select bu.id, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
        from public.bunches bu where bu.id = cycle_uuid;
    else
      cycle_uuid := cycle_row.id;
    end if;
  end if;

  insert into public.praises(id, board_id, bunch_id, actor_user_id, recipient_user_id, request_receipt_id, source, message, occurred_on, tag, tags)
    values (praise_uuid, board_row.id, cycle_uuid, actor, actor, receipt_uuid, 'self', normalized_message, p_occurred_on, private.legacy_praise_tag(normalized_tags), normalized_tags);
  select count(*)::integer into v_valid_count from public.praises p
    where p.bunch_id = cycle_uuid and p.cancelled_at is null and p.excluded_at is null;
  if v_valid_count > cycle_row.target_count then raise exception using errcode = 'PT503', message = 'bunch_count_invalid'; end if;
  completed_now := v_valid_count = cycle_row.target_count;
  update public.bunches set valid_count = v_valid_count,
    progress_state = case when completed_now then 'complete' else 'incomplete' end,
    completed_at = case when completed_now then coalesce(completed_at, now_at) else null end
    where id = cycle_uuid and board_id = board_row.id;
  if completed_now then
    if actor is distinct from private.require_actor() then raise exception using errcode = 'PT503', message = 'actor_context_changed'; end if;
    insert into public.notifications(recipient_user_id, actor_user_id, type, dedupe_key, bunch_id)
      values (private.require_actor(), actor, 'bunch_completed', 'bunch-completed:' || cycle_uuid::text, cycle_uuid)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id', praise_uuid, 'replayed', false);
end $$;
alter function private.create_self_praise_core(uuid, uuid, text, date, text, text[]) owner to chagokchan_rpc;
revoke all on function private.create_self_praise_core(uuid, uuid, text, date, text, text[]) from public, anon, authenticated, service_role;

create or replace function public.create_praise(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tag text default null
) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$
  select private.create_self_praise_core(p_request_key,p_board_id,p_message,p_occurred_on,p_tag,null);
$$;
alter function public.create_praise(uuid,uuid,text,date,text) owner to chagokchan_rpc;
revoke all on function public.create_praise(uuid,uuid,text,date,text) from public,anon,authenticated,service_role;
grant execute on function public.create_praise(uuid,uuid,text,date,text) to authenticated;

create function public.create_personal_praise_with_tags(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tags text[] default '{}'
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid; result jsonb; praise_id uuid; cycle_id uuid;
begin
  actor := private.require_actor();
  if p_tags is null then raise exception using errcode='PT400', message='invalid_praise_input'; end if;
  result := private.create_self_praise_core(p_request_key,p_board_id,p_message,p_occurred_on,null,p_tags);
  praise_id := (result->>'id')::uuid;
  select p.bunch_id into cycle_id from public.praises p where p.id=praise_id and p.board_id=p_board_id
    and p.actor_user_id=actor and p.recipient_user_id=actor and p.source='self';
  if not found or cycle_id is null then raise exception using errcode='PT503', message='praise_result_unavailable'; end if;
  return jsonb_build_object('id',praise_id,'bunch_id',cycle_id,'replayed',(result->>'replayed')::boolean);
end $$;
alter function public.create_personal_praise_with_tags(uuid,uuid,text,date,text[]) owner to chagokchan_rpc;
revoke all on function public.create_personal_praise_with_tags(uuid,uuid,text,date,text[]) from public,anon,authenticated,service_role;
grant execute on function public.create_personal_praise_with_tags(uuid,uuid,text,date,text[]) to authenticated;
create or replace function public.edit_self_praise(p_praise_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_praise record; actor_timezone text; next_message text; next_occurred_on date; next_tag text; next_tags text[]; has_tags boolean;
  has_message boolean; has_date boolean; has_tag boolean; utc_minute timestamptz; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or
     (p_patch - 'message' - 'occurred_on' - 'tag' - 'tags') <> '{}'::jsonb or p_patch = '{}'::jsonb then
    raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
  end if;
  if p_patch ? 'tag' and p_patch ? 'tags' then raise exception using errcode = 'PT400', message = 'invalid_praise_patch'; end if;
  has_tags := p_patch ? 'tags';
  has_message := p_patch ? 'message'; has_date := p_patch ? 'occurred_on'; has_tag := p_patch ? 'tag';
  select p.id, p.board_id, p.bunch_id, p.actor_user_id, p.recipient_user_id, p.source, p.message, p.occurred_on, p.tag, p.tags,
    p.cancelled_at, p.excluded_at, p.author_erased_at, g.status as goal_status, a.timezone as actor_timezone
    into current_praise from public.praises p
    join public.boards b on b.id = p.board_id
    join public.goals g on g.id = b.goal_id
    join public.app_users a on a.id = actor
    where p.id = p_praise_id for update of p, g;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.actor_user_id is distinct from actor then raise exception using errcode = 'PT403', message = 'praise_not_author'; end if;
  if current_praise.source <> 'self' or current_praise.recipient_user_id <> actor then raise exception using errcode = 'PT403', message = 'self_praise_required'; end if;
  if current_praise.goal_status = 'deleted' then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.cancelled_at is not null then raise exception using errcode = 'PT409', message = 'praise_cancelled'; end if;
  next_message := current_praise.message;
  if has_message then
    if jsonb_typeof(p_patch->'message') not in ('string', 'null') then raise exception using errcode = 'PT400', message = 'invalid_praise_patch'; end if;
    next_message := case when jsonb_typeof(p_patch->'message') = 'null' then null else
      nullif(normalize(replace(replace(p_patch->>'message', E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
    if next_message is not null and char_length(next_message) > 1000 then raise exception using errcode = 'PT400', message = 'invalid_praise_patch'; end if;
  end if;
  next_occurred_on := current_praise.occurred_on;
  if has_date then
    if jsonb_typeof(p_patch->'occurred_on') = 'null' then next_occurred_on := null;
    elsif jsonb_typeof(p_patch->'occurred_on') = 'string' and p_patch->>'occurred_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin next_occurred_on := (p_patch->>'occurred_on')::date;
      exception when others then raise exception using errcode = 'PT400', message = 'invalid_occurred_on'; end;
    else raise exception using errcode = 'PT400', message = 'invalid_occurred_on'; end if;
    if next_occurred_on is not null and (next_occurred_on > (now_at at time zone current_praise.actor_timezone)::date or
       next_occurred_on < (now_at at time zone current_praise.actor_timezone)::date - 365) then
      raise exception using errcode = 'PT400', message = 'occurred_on_out_of_range';
    end if;
  end if;
  next_tags := current_praise.tags;
  if has_tags then
    if jsonb_typeof(p_patch->'tags') <> 'array' or exists(select 1 from jsonb_array_elements(p_patch->'tags') v where jsonb_typeof(v) <> 'string') then
      raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
    end if;
    next_tags := private.normalize_praise_tags(array(select jsonb_array_elements_text(p_patch->'tags')));
  end if;
  next_tag := current_praise.tag;
  if has_tag then
    if current_praise.tags is distinct from private.legacy_praise_tags(current_praise.tag) then
      raise exception using errcode = 'PT409', message = 'legacy_tag_conflict';
    end if;
    if jsonb_typeof(p_patch->'tag') not in ('string', 'null') then
      raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
    end if;
    next_tag := p_patch->>'tag';
    if next_tag is not null and next_tag not in ('consistency', 'courage', 'care', 'growth', 'rest') then
      raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
    end if;
  end if;
  if has_tag then next_tags := private.legacy_praise_tags(next_tag); end if;
  next_tag := private.legacy_praise_tag(next_tags);
  if next_message is not distinct from current_praise.message and next_occurred_on is not distinct from current_praise.occurred_on and
     next_tags is not distinct from current_praise.tags then
    return jsonb_build_object('id', current_praise.id, 'replayed', true);
  end if;
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_state_change_minute', 60, utc_minute, utc_minute + interval '1 minute');
  update public.praises set message = next_message, occurred_on = next_occurred_on, tag = next_tag, tags = next_tags where id = current_praise.id;
  return jsonb_build_object('id', current_praise.id, 'replayed', false);
end $$;
alter function public.edit_self_praise(uuid, jsonb) owner to chagokchan_rpc;
revoke all on function public.edit_self_praise(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.edit_self_praise(uuid, jsonb) to authenticated;

create or replace function public.cancel_praise(p_praise_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare locked_cycle jsonb; current_praise record; utc_minute timestamptz;
  now_at timestamptz := clock_timestamp();
begin
  locked_cycle := private.lock_praise_cycle(p_praise_id);
  select p.id, p.bunch_id, p.cancelled_at into current_praise
    from public.praises p where p.id = p_praise_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  -- Check deletion before replay, while holding the goal row lock.
  if locked_cycle->>'goal_status' = 'deleted' then
    raise exception using errcode = 'PT404', message = 'praise_not_found';
  end if;
  if current_praise.cancelled_at is not null then return jsonb_build_object('id', current_praise.id, 'replayed', true); end if;
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(private.require_actor(), 'praise_state_change_minute', 60, utc_minute, utc_minute + interval '1 minute');
  update public.praises set cancelled_at = now_at, message = null, occurred_on = null, tag = null, tags = '{}'::text[] where id = current_praise.id;
  perform private.recount_bunch(current_praise.bunch_id, now_at);
  return jsonb_build_object('id', current_praise.id, 'replayed', false);
end $$;
alter function public.cancel_praise(uuid) owner to chagokchan_rpc;
revoke all on function public.cancel_praise(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_praise(uuid) to authenticated;

create or replace function public.list_board_praises(
  p_board_id uuid, p_bunch_id uuid default null, p_cursor text default null, p_limit integer default 20, p_include_hidden boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_row record; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  last_at timestamptz; last_id uuid; item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null; view_value jsonb;
begin
  actor := private.require_actor();
  if p_board_id is null or p_limit not between 1 and 50 or p_include_hidden is null then
    raise exception using errcode = 'PT400', message = 'invalid_praise_list';
  end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  select b.id, b.owner_user_id, b.kind into board_row from public.boards b join public.goals g on g.id=b.goal_id
    where b.id=p_board_id and g.status <> 'deleted'
      and (b.owner_user_id=actor or private.current_shared_board_member(b.id,b.owner_user_id,actor));
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if p_bunch_id is not null and not exists(select 1 from public.bunches bu where bu.id=p_bunch_id and bu.board_id=p_board_id) then
    raise exception using errcode = 'PT404', message = 'bunch_not_found';
  end if;
  if board_row.owner_user_id <> actor and p_include_hidden then
    raise exception using errcode = 'PT403', message = 'board_access_denied';
  end if;
  for item in
    select pr.id, pr.bunch_id, pr.source, pr.actor_user_id, pr.message, pr.occurred_on, pr.tag, pr.tags, pr.recorded_at,
      pr.cancelled_at, pr.hidden_at, pr.excluded_at, pr.author_erased_at, p.nickname, p.avatar_key
    from public.praises pr left join public.profiles p on p.user_id=pr.actor_user_id
    where pr.board_id=p_board_id and (p_bunch_id is null or pr.bunch_id=p_bunch_id)
      and (board_row.owner_user_id=actor or pr.actor_user_id=actor)
      and (board_row.owner_user_id <> actor or p_include_hidden or pr.hidden_at is null)
      and (cursor_at is null or (pr.recorded_at, pr.id) < (cursor_at,cursor_id))
    order by pr.recorded_at desc, pr.id desc limit p_limit+1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at,last_id);
      exit;
    end if;
    if board_row.owner_user_id=actor then
      view_value := jsonb_build_object('viewer_role','owner','id',item.id,'bunch_id',item.bunch_id,'source',item.source,
        'actor',case when item.actor_user_id is null or item.nickname is null then null else jsonb_build_object(
          'user_id',item.actor_user_id,'nickname',item.nickname,'avatar_key',coalesce(item.avatar_key,'grape')) end,
        'actor_label',case when item.actor_user_id is null then '삭제된 사용자' when item.nickname is null then '연결 종료 사용자' else item.nickname end,
        'message',item.message,'occurred_on',item.occurred_on,'tag',item.tag,'tags',item.tags,'recorded_at',item.recorded_at,
        'cancelled_at',item.cancelled_at,'hidden_at',item.hidden_at,'excluded_at',item.excluded_at,'author_erased_at',item.author_erased_at);
    else
      view_value := jsonb_build_object('viewer_role','contributor','id',item.id,'bunch_id',item.bunch_id,'source','peer',
        'message',item.message,'recorded_at',item.recorded_at,'cancelled_at',item.cancelled_at);
    end if;
    items := items || jsonb_build_array(view_value);
    last_at := item.recorded_at; last_id := item.id; item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_board_praises(uuid, uuid, text, integer, boolean) owner to chagokchan_rpc;
revoke all on function public.list_board_praises(uuid, uuid, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.list_board_praises(uuid, uuid, text, integer, boolean) to authenticated;

revoke create on schema public, private from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
