/* ============================================================
   Anagram Ace — original game for PixelPlay
   Canvas word-unscramble: seven tiles from a hidden seed word,
   90-second rounds, streak multiplier, grouped found list.
   Type on the keyboard or tap tiles; Enter submits.
   Pause is P / Esc only (Enter must submit), R restarts.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var ROUND_TIME = 90;
  var BEST_KEY = 'anagram-ace';
  var FONT = '"Segoe UI", system-ui, sans-serif';
  var TAU = Math.PI * 2;

  var SCORES = { 3: 30, 4: 60, 5: 100, 6: 160, 7: 250 };

  /* GameShell is provided by ../js/game-page.js, which loads first.
     The no-op fallback only exists so this file can never throw. */
  var GameShell = window.GameShell;
  if (!GameShell) {
    GameShell = {
      hud: function () {},
      overlay: { show: function () {}, hide: function () {} },
      best: { get: function (k, f) { return f || 0; }, set: function () {} }
    };
  }

  /* ---------------- dictionary ----------------
     Common, family-friendly words, 3-8 letters, embedded (no fetches).
     Seeds are 7-letter entries; the game only seeds from words that
     have plenty of smaller sub-words inside this list. */

  var DICT = [
    'act','add','age','air','and','ant','ape','arc','are','arm',
    'art','ash','ask','ate','awe','bad','bag','ban','bar','bat',
    'bed','bet','big','bit','bow','boy','bud','bug','bus','but',
    'buy','cab','can','cap','car','cat','cop','cow','cry','cub',
    'cup','cut','day','den','dig','dim','din','dip','doe','dog',
    'dot','dry','due','dug','duo','dye','ear','eat','eel','egg',
    'ego','elf','elm','end','era','eve','eye','fan','far','fat',
    'fed','few','fig','fin','fir','fit','fix','fly','foe','fog',
    'for','fox','fry','fun','fur','gap','gas','gem','get','gin',
    'god','gum','gun','gut','guy','gym','had','ham','has','hat',
    'hem','hen','her','hid','hip','his','hit','hoe','hog','hop',
    'hot','how','hub','hue','hug','hum','hut','ice','icy','ink',
    'ion','its','ivy','jab','jam','jar','jaw','jet','job','jog',
    'joy','jug','jut','keg','key','kid','kin','kit','lap','law',
    'lay','led','leg','let','lid','lie','lip','lit','log','lot',
    'low','mad','man','map','mat','may','men','met','mix','mob',
    'mom','mop','mud','mug','nag','nap','net','new','nod','nor',
    'not','now','nun','nut','oar','oat','odd','oil','old','one',
    'opt','orb','ore','our','out','owe','owl','own','pad','pan',
    'par','pat','paw','pay','pea','peg','pen','pet','pie','pig',
    'pin','pit','pod','pop','pot','pro','pub','pup','put','rag',
    'ram','ran','rap','rat','raw','ray','red','rib','rid','rig',
    'rim','rip','rob','rod','rot','row','rub','rug','run','rut',
    'rye','sad','sag','sap','sat','saw','say','sea','set','sew',
    'she','shy','sin','sip','sir','sit','six','ski','sky','sly',
    'sod','son','sow','soy','spa','spy','sub','sue','sum','sun',
    'tab','tad','tag','tan','tap','tar','tax','tea','ten','the',
    'tie','tin','tip','toe','ton','too','top','tow','toy','try',
    'tub','tug','two','use','van','vat','vet','via','vow','wad',
    'wag','war','was','wax','way','web','wed','wet','who','why',
    'wig','win','wit','woe','won','woo','wry','yam','yes','yet',
    'you','zip','zoo','able','acid','aged','also','area','away','baby',
    'back','bake','ball','band','bank','bare','barn','base','bath','beam',
    'bear','beat','been','bell','belt','bend','best','bike','bill','bind',
    'bird','bite','blow','blue','boat','body','boil','bold','bomb','bond',
    'bone','book','born','boss','both','bowl','bulk','burn','bush','busy',
    'cage','cake','call','calm','came','camp','card','care','case','cash',
    'cast','cave','cell','chat','chip','city','club','coal','coat','code',
    'cold','come','cook','cool','cope','copy','core','cost','crew','crop',
    'dark','data','date','dawn','days','dead','deal','dear','debt','deep',
    'deer','desk','dial','diet','dirt','dish','does','done','door','dose',
    'down','draw','drop','drug','drum','dust','duty','each','earn','ease',
    'east','easy','edge','else','even','ever','evil','face','fact','fade',
    'fail','fair','fall','farm','fast','fear','feed','feet','fell','felt',
    'file','fill','film','find','fine','fire','firm','fish','five','flag',
    'flat','flow','food','foot','form','four','free','frog','fuel','full',
    'gain','game','gate','gave','gear','gene','gift','girl','give','glad',
    'goal','goes','gold','golf','gone','good','gray','grew','grow','half',
    'hall','hand','hang','hard','harm','hate','have','head','hear','heat',
    'held','help','here','hero','high','hill','hire','hold','hole','home',
    'hope','hour','huge','hung','hunt','hurt','idea','inch','into','iron',
    'item','join','jump','just','keen','keep','kept','kick','kind','king',
    'knew','know','lack','lady','laid','lake','lamp','land','lane','last',
    'late','lead','lean','left','lend','less','liar','life','lift','like',
    'line','link','lion','list','live','load','loan','lock','long','look',
    'loop','lord','loss','lost','love','luck','made','mail','main','make',
    'male','many','mark','mass','mate','math','mean','meat','meet','menu',
    'mile','milk','mind','mine','miss','mode','mood','moon','more','most',
    'move','much','must','name','navy','near','neck','need','nest','news',
    'next','nice','nine','node','none','noon','nose','note','once','only',
    'onto','open','oral','over','pace','pack','page','paid','pain','pair',
    'pale','palm','park','part','pass','past','path','peak','pear','pick',
    'pile','pill','pine','pipe','plan','play','plot','plow','plus','poem',
    'pole','pool','port','post','pour','pray','pull','pump','pure','push',
    'quit','race','rail','rain','rank','rare','rate','read','real','rear',
    'rent','rest','rice','rich','ride','ring','rise','road','rock','role',
    'roll','roof','room','root','rose','rule','rush','safe','sail','sake',
    'sale','salt','same','sand','save','seat','seed','seek','seem','seen',
    'sell','send','ship','shoe','shot','show','shut','sick','side','sign',
    'sing','sink','site','size','skin','slip','slow','snow','soft','soil',
    'sold','sole','some','song','soon','sore','sort','soul','soup','spot',
    'star','stay','stem','step','stir','stop','such','suit','sure','take',
    'tale','talk','tall','tape','task','team','tear','tell','tend','term',
    'test','text','than','that','thaw','them','then','they','thin','this',
    'thus','tick','tide','tidy','tile','tilt','tiny','tire','toad','told',
    'tone','tool','torn','tour','town','trap','tree','trip','true','turn',
    'type','ugly','unit','upon','urge','used','user','vain','vary','vase',
    'vast','veil','vein','verb','very','vest','view','vine','visa','vote',
    'wade','wage','wait','wake','walk','wall','want','warm','warn','wash',
    'wave','wear','week','well','went','were','west','what','when','wide',
    'wife','wild','will','wind','wine','wing','wire','wise','wish','wood',
    'word','wore','work','yard','year','your','zero','zone','about','above',
    'abuse','actor','acute','admit','adopt','adult','after','again','agent','agree',
    'ahead','alarm','album','alert','alike','alive','allow','alone','along','alter',
    'among','anger','angle','angry','apart','apple','apply','arena','argue','arise',
    'armor','arrow','aside','asset','audio','avoid','awake','award','aware','badge',
    'basic','basis','beach','beard','beast','began','begin','being','below','bench',
    'birth','black','blade','blame','blank','blast','blaze','blend','blind','block',
    'bloom','board','bonus','boost','bound','brain','brand','brave','bread','break',
    'breed','brief','bring','broad','broke','brook','brown','brush','build','built',
    'burst','buyer','cable','candy','cargo','carry','catch','cause','chain','chair',
    'charm','chase','cheap','check','chest','chief','child','chill','chose','chunk',
    'civic','civil','claim','class','clean','clear','click','climb','clock','close',
    'cloth','cloud','coach','coast','colon','color','comet','comic','coral','couch',
    'cough','could','count','court','cover','crack','craft','crash','crazy','cream',
    'crime','crisp','cross','crowd','crown','crude','cruel','crush','curve','cycle',
    'daily','dairy','dance','dealt','debut','decay','decor','delay','delta','dense',
    'depth','diary','dirty','doubt','dozen','draft','drama','drawn','dream','dress',
    'dried','drift','drill','drink','drive','drove','dying','eager','early','earth',
    'eaten','eight','elbow','elder','elect','elite','empty','enemy','enjoy','enter',
    'entry','equal','error','event','every','exact','exist','extra','fable','faint',
    'fairy','faith','false','fancy','fatal','fault','favor','feast','fence','ferry',
    'fever','fewer','fiber','field','fifth','fifty','fight','final','first','fixed',
    'flame','flash','fleet','flesh','fling','float','flock','flood','floor','flour',
    'fluid','flush','focus','force','forge','forth','forty','forum','found','frame',
    'fraud','fresh','front','fruit','fully','funny','ghost','giant','given','glass',
    'gleam','globe','gloom','glory','glove','going','grace','grade','grain','grand',
    'grant','grape','graph','grasp','grass','grave','graze','great','green','greet',
    'grief','grill','grind','groan','group','guard','guess','guest','guide','guilt',
    'happy','hardy','harsh','haste','hatch','haunt','heart','heavy','hedge','hello',
    'hence','hobby','honey','honor','horse','hotel','house','human','humor','hurry',
    'ideal','image','imply','index','inner','input','irony','issue','jelly','jewel',
    'joint','jolly','judge','juice','kayak','label','labor','large','laser','later',
    'laugh','layer','learn','lease','least','leave','legal','lemon','level','light',
    'limit','linen','liner','lithe','liver','lobby','local','lodge','logic','loose',
    'lorry','lower','loyal','lucky','lunar','lunch','lying','magic','major','maker',
    'mango','maple','march','marry','match','mayor','meant','medal','media','mercy',
    'merge','merit','metal','meter','midst','might','mimic','minor','minus','mirth',
    'mixed','model','moist','money','month','moral','motor','mount','mourn','mouse',
    'mouth','movie','music','myths','naked','nasty','nerve','never','newly','night',
    'noble','noise','north','noted','novel','nurse','oasis','occur','ocean','offer',
    'often','olive','onion','opera','orbit','order','organ','other','otter','ought',
    'ounce','outer','owner','oxide','panel','panic','paper','patch','pause','peace',
    'peach','pearl','pedal','penny','perch','phase','phone','photo','piano','picky',
    'piece','pilot','pinch','pitch','pixel','place','plain','plane','plank','plant',
    'plate','plaza','plead','pluck','plumb','plump','plush','point','polar','porch',
    'pound','power','press','price','pride','prime','print','prior','prize','probe',
    'prone','proof','proud','prove','proxy','pulse','pupil','purse','quake','queen',
    'query','quest','queue','quick','quiet','quilt','quite','quote','radar','radio',
    'raise','rally','ranch','range','rapid','raven','reach','react','ready','realm',
    'rebel','refer','reign','relax','relay','relic','remit','renal','renew','repay',
    'reply','rerun','retro','reuse','revel','rhino','rhyme','rider','ridge','rifle',
    'right','rigid','rinse','risen','rival','river','roast','robin','robot','rocky',
    'rogue','rough','round','route','royal','rugby','ruler','rumor','rural','sadly',
    'safer','saint','salad','sales','salon','salsa','salty','sandy','sauce','scale',
    'scarf','scene','scent','scoop','scope','score','scout','scrap','scrub','sense',
    'serve','setup','seven','shade','shaft','shake','shall','shame','shape','share',
    'shark','sharp','shave','sheer','sheet','shelf','shell','shift','shine','shiny',
    'shirt','shock','shoot','shore','short','shown','shrub','sight','silky','silly',
    'since','sixth','sixty','skate','skill','skull','slate','sleek','sleep','slice',
    'slide','slime','slope','small','smart','smash','smell','smile','smoke','snack',
    'snake','sneak','snowy','sober','solar','solid','solve','sorry','sound','south',
    'space','spare','spark','speak','spear','speed','spell','spend','spice','spike',
    'spill','spine','split','spoke','spoon','sport','spray','stack','staff','stage',
    'stain','stair','stake','stale','stalk','stall','stamp','stand','stare','stark',
    'start','state','steak','steal','steam','steel','steep','steer','stern','stick',
    'stiff','still','sting','stock','stole','stood','stool','store','storm','story',
    'stout','stove','strap','straw','stray','strip','stuck','study','stuff','stunt',
    'style','sugar','suite','sunny','super','surge','sushi','swarm','swear','sweat',
    'sweep','sweet','swell','swift','swing','sword','syrup','taken','tamer','taste',
    'teach','tempo','tenor','tense','tenth','thank','theft','their','theme','there',
    'these','thick','thief','thigh','thing','think','third','those','three','threw',
    'throw','thumb','tiger','tight','tired','title','toast','today','token','tonic',
    'tooth','topic','torch','total','touch','tough','towel','tower','toxic','trace',
    'track','trade','trail','train','trait','tramp','trash','treat','trend','trial',
    'tribe','trick','tried','troop','truck','truly','trunk','trust','truth','tulip',
    'tummy','tutor','twice','twist','ultra','uncle','under','union','unite','unity',
    'until','upper','upset','urban','usage','usual','utter','vague','valid','value',
    'video','viral','virus','visit','vital','vivid','vocal','voice','voter','vowel',
    'wagon','waist','waltz','waste','watch','water','weary','weave','wedge','weigh',
    'weird','whale','wheat','wheel','where','which','while','white','whole','whose',
    'widen','widow','width','windy','witch','woman','women','world','worry','worse',
    'worst','worth','would','wound','wrath','wreck','wrist','write','wrong','wrote',
    'yacht','yeast','yield','young','yours','youth','zebra','absorb','access','action',
    'active','actual','advice','advise','affect','afford','afraid','agency','agenda','almost',
    'always','amount','animal','annual','answer','anyone','anyway','appeal','appear','around',
    'arrive','artist','aspect','assess','assist','assume','attach','attack','attend','august',
    'author','avenue','backed','barely','battle','beauty','became','become','before','behalf',
    'behave','behind','belief','belong','better','beyond','bishop','bitter','blanket','bottle',
    'bottom','bought','branch','breath','bridge','bright','broken','bronze','brought','browser',
    'bubble','bucket','bundle','butter','button','bypass','camera','cancer','cannot','carbon',
    'career','castle','casual','caught','cellar','centre','chance','change','charge','cheese',
    'cherry','choose','chosen','church','circle','circus','client','closet','closer','coffee',
    'column','combat','coming','common','comply','copper','corner','cosmic','cotton','county',
    'couple','course','cousin','create','credit','crisis','custom','damage','dancer','danger',
    'dealer','debate','decade','decide','defeat','defend','define','degree','demand','depend',
    'deploy','deputy','desert','design','desire','detail','detect','device','dinner','direct',
    'divide','doctor','dollar','domain','double','driven','driver','during','easily','eating',
    'editor','effect','effort','eighth','either','eleven','emerge','empire','enable','ending',
    'energy','engage','engine','enough','ensure','entire','entity','equity','escape','estate',
    'ethnic','exceed','except','excite','excuse','expand','expect','expert','export','expose',
    'extend','extent','fabric','factor','failed','fairly','fallen','family','famous','farmer',
    'father','fellow','female','figure','filing','filter','finger','flight','flower','flying',
    'follow','forbid','forced','forest','forget','formal','format','former','fossil','foster',
    'fourth','freeze','french','friend','frozen','future','garden','gather','gender','gentle',
    'gently','giggle','glance','global','glossy','goblet','gospel','gossip','gotten','gravel',
    'grocery','gutter','handle','happen','hardly','hazard','health','height','helmet','hidden',
    'highly','hollow','honest','horizon','hostel','humanity','humble','hunter','icebox','ignore',
    'impact','import','impose','income','indeed','injury','insect','insert','inside','insist',
    'intact','intend','intent','invest','island','itself','jungle','junior','kernel','kettle',
    'kinder','knight','ladder','lately','latest','latter','launch','lawyer','leader','league',
    'leather','legend','length','lesson','letter','lights','likely','limber','linear','liquid',
    'listen','little','living','locate','locked','locker','lonely','longer','lovely','mainly',
    'manage','manner','manual','marble','margin','marine','market','master','matter','medium',
    'member','memory','mental','mentor','merely','method','middle','mighty','mildew','mining',
    'minute','mirror','mobile','modern','modest','moment','monkey','mortal','mostly','mother',
    'motion','murder','muscle','museum','mutual','myself','narrow','nation','native','nature',
    'nearby','nearly','neatly','needle','nickel','nobody','normal','notice','notion','number',
    'object','obtain','occupy','offend','office','online','option','orange','orchid','origin',
    'output','oyster','packed','palace','parent','parish','partly','patent','patrol','pattern',
    'people','pepper','period','permit','person','phrase','pillow','planet','player','please',
    'pocket','poetry','poison','police','policy','polish','ponder','poplar','portal','potato',
    'potter','powder','powers','precise','prefer','pretty','prince','prison','profit','proper',
    'propose','proven','public','pudding','pulley','pumpkin','pursue','puzzle','python','quartz',
    'rabbit','racial','random','rather','rating','reader','really','reason','recall','recent',
    'record','reduce','reform','refuse','regard','regime','region','reject','relate','relief',
    'remain','remark','remote','remove','render','repair','repeat','replay','report','rescue',
    'resist','resort','result','retail','retain','retire','return','reveal','review','reward',
    'rhythm','ribbon','rocket','rubber','runner','sacred','safety','salary','salmon','sample',
    'sandal','savage','scheme','school','screen','script','scroll','search','season','secret',
    'sector','secure','select','senate','senior','series','settle','severe','shadow','shaken',
    'shield','shiver','should','shovel','shower','simple','simply','singer','single','sister',
    'skinny','slight','slowly','smooth','social','solely','solemn','solved','sorrow','source',
    'speech','spirit','spread','spring','square','squeeze','stable','stance','steady','stolen',
    'strain','strand','street','stress','strict','strike','string','stripe','stroke','strong',
    'submit','subtle','sudden','suffer','summer','summit','sunset','supply','surely','survey',
    'switch','symbol','system','talent','target','temple','tender','tennis','terrible','thatch',
    'theory','thirty','thorn','thread','throne','thunder','ticket','timber','tissue','tongue',
    'toward','travel','treaty','tribal','triple','trophy','tunnel','twelve','twenty','unable',
    'unfair','unique','united','unless','unlike','unlock','update','upward','useful','vacant',
    'valley','vanish','vendor','verify','victim','viewer','vigour','violet','violin','virtue',
    'vision','visual','volume','walker','wallet','walnut','wander','weapon','weekly','weight',
    'wholly','wicked','widely','widget','window','winner','winter','wisdom','wonder','wooden',
    'worker','worthy','writer','yellow','ability','absence','academy','account','accused','achieve',
    'acquire','address','advance','adverse','advised','adviser','against','airline','already','amateur',
    'amazing','ancient','another','anxiety','anybody','applied','arrival','article','artwork','assault',
    'athlete','attempt','attract','auction','average','balance','banking','barrier','battery','bearing',
    'because','bedroom','believe','beneath','benefit','besides','between','billion','binding','brother',
    'burning','cabinet','caliber','calling','capable','capital','capture','careful','carried','cautious',
    'ceiling','central','century','certain','chamber','channel','chapter','charity','charter','checked',
    'chicken','chronic','circuit','citizen','classic','cluster','coastal','collect','college','combine',
    'comfort','command','comment','compact','company','compare','compete','complex','compose','concept',
    'concern','concert','conduct','confirm','connect','consent','consist','contact','contain','content',
    'contest','context','control','convert','cooking','correct','council','counter','country','courage',
    'coverage','crystal','culture','cupboard','curious','current','cutting','dealing','decided','declared',
    'decline','default','defence','deliver','density','deposit','desktop','despite','destiny','develop',
    'devoted','digital','disable','disagree','disaster','discuss','disease','dismiss','display','dispute',
    'distant','diverse','divorce','drawing','driving','dropped','dynamic','earning','eclipse','edition',
    'educated','elderly','elegant','element','elevated','embrace','emotion','emperor','enclosed','endless',
    'engaged','enhance','enlarge','enquiry','escaped','ethics','evening','exactly','example','excited',
    'exclude','exhaust','exhibit','expense','explain','explore','express','extreme','factory','faculty',
    'failing','failure','fashion','fasting','favour','feature','federal','fiction','fifteen','fighter',
    'filling','finally','finance','finding','fishing','fitness','flaming','flavour','follows','forcing',
    'forever','formula','fortune','forward','founder','freedom','freight','friends','frontal','frosted',
    'fruits','fulcrum','further','gallery','gateway','general','genuine','gesture','glacier','glimpse',
    'glisten','glitter','gondola','gorilla','graceful','granite','graphic','grapple','gravity','greater',
    'greatly','greeter','grimace','grooves','ground','growth','guardian','guitar','habitat','halfway',
    'handbag','harbour','harvest','hastily','heading','healthy','hearing','heavily','helpful','hereby',
    'heretic','herself','highway','himself','history','holding','holiday','horror','hostile','housing',
    'however','hundred','hunting','husband','ignorant','illusion','imagine','immense','implied','imposed',
    'improve','impulse','include','initial','innocent','inquiry','insight','inspect','install','instant',
    'instead','intense','interim','invalid','involve','isolate','javelin','journal','journey','justice',
    'justify','kitchen','kingdom','language','laughter','laundry','leading','learned','lecture','legally',
    'leisure','lengthy','liberal','liberty','library','license','limited','linking','literal','lobbying',
    'logical','loyalty','machines','manager','mandate','manifest','mankind','marbles','martial','maximum',
    'meaning','measure','mediate','medicine','memorial','merchant','midwife','mineral','minimal','minimum',
    'miracle','missing','mission','mixture','monitor','monster','monthly','morning','mystery','natural',
    'nearest','neighbor','nineteen','nothing','notable','notably','nuclear','nursing','obesity','obvious',
    'offense','officer','ongoing','opening','operate','opinion','organic','outcome','outdoor','outlined',
    'outlook','outside','overall','package','painter','parking','partial','partner','passage','passing',
    'passive','patient','payment','penalty','pension','percent','perfect','perhaps','persona','phoenix',
    'picture','pioneer','plastic','pleased','podium','politic','popcorn','portion','poverty','predict',
    'premier','premium','prepare','present','prevent','primary','printer','privacy','private','problem',
    'proceed','process','produce','product','profile','program','project','promise','promote','protect',
    'protein','protest','provide','publish','pursuit','qualify','quarter','question','quickly','quietly',
    'radiant','rainbow','raising','randomly','reality','realize','receipt','receive','recovery','recycle',
    'reduced','refugee','register','regular','related','release','remains','removal','renewal','replace',
    'replica','replied','request','require','reserve','resolve','respect','respond','restore','retreat',
    'revenue','reverse','robbery','romance','rucksack','running','satisfy','scatter','scholar','scratch',
    'security','sentence','separate','serious','service','session','seventy','shelter','shortly','shoulder',
    'silence','sincere','sixteen','smoothly','society','soldier','somehow','speaker','special','sponsor',
    'station','storage','strange','student','subject','succeed','success','suggest','summary','support',
    'suppose','supreme','surface','surgeon','surplus','survive','suspect','teacher','telling','tendency',
    'terminal','terrific','testing','thirteen','thorough','thousand','tonight','totally','tourism','towards',
    'tracking','training','transfer','travels','treated','triangle','tribute','trouble','turning','ultimate',
    'uniform','unknown','unusual','updated','upstairs','useless','usually','variable','vertical','veteran',
    'victory','village','vinegar','visible','volcano','warrant','warrior','weakness','weather','website',
    'wedding','weekend','welcome','welfare','western','whether','whisper','whoever','willing','winning',
    'without','witness','writing','written','absolute','abstract','accident','accurate','aircraft','alliance',
    'although','ambition','analysis','announce','anything','apparent','appetite','approach','approval','argument',
    'artistic','assembly','athletic','audience','backyard','baggage','bankrupt','bathroom','birthday','blizzard',
    'boundary','building','bulletin','business','calendar','campaign','capacity','carriage','cartoon','category',
    'ceremony','champion','circular','civilian','climbing','commence','commerce','commonly','commuter','compared',
    'compiler','complain','complete','composed','compound','comprise','computer','conclude','concrete','conflict',
    'congress','consider','constant','consumer','continue','contract','contrary','contrast','convince','corridor',
    'creative','creature','criminal','critical','crossing','cultural','currency','customer','database','daughter',
    'deadline','decision','decrease','defender','delicate','delivery','describe','designer','detailed','dialogue',
    'dinosaur','diplomat','directly','distance','distinct','district','dividend','division','doctrine','document',
    'domestic','dominant','download','driveway','drought','duration','dwelling','dynamite','earnings','economic',
    'educator','election','elephant','eligible','emphasis','employee','employer','endpoint','engineer','enormous',
    'entrance','envelope','equality','equation','estimate','evaluate','eventual','everyone','evident','exchange',
    'exercise','existed','existing','expanded','expedite','explicit','exposure','extended','external','fabulous',
    'facility','familiar','favorite','feasible','feedback','festival','finalist','firewall','flagship','flexible',
    'floating','footstep','forecast','foremost','formerly','fortress','fraction','fragment','frequent','friendly',
    'frontier','function','generate','generous','genetics','gorgeous','graduate','graffiti','grateful','guidance',
    'handbook','handsome','happened','hardship','headline','hesitate','highland','historic','homework','honestly',
    'horrible','hospital','humorous','hydrogen','immature','imperial','incident','increase','indicate','indirect',
    'industry','infinite','informed','inherent','initiate','innovate','inspired','instance','integral','interact',
    'interest','interior','internal','interval','intimate','invasion','investor','involved','isolated','judgment',
    'keyboard','landlord','landmark','learning','lighting','likewise','literary','logistic','logbook','maintain',
    'majority','manifold','marathon','marginal','marriage','material','maximize','meantime','measured','mechanic',
    'medieval','midnight','military','minimize','minister','minority','missions','moderate','momentum','monument',
    'mortgage','movement','multiple','mutation','national','navigate','negative','nitrogen','nobleman','nominate',
    'notebook','nucleus','numerous','obscure','observer','obtained','occupied','occurred','operator','opponent',
    'opposite','optimism','ordinary','organise','organism','original','outbreak','outfield','outgoing','outrage',
    'overcome','overhead','overlook','overseas','overview','painting','parallel','parental','particle','partners',
    'passion','peaceful','perceive','periodic','personal','persuade','petition','pharmacy','physical','pictures',
    'pipeline','platform','pleasant','pleasure','poignant','polished','politics','portrait','position','positive',
    'possible','powerful','practice','precious','pregnant','premiere','premises','prepared','presence','preserve',
    'pressure','prestige','presume','previous','princess','prisoner','probable','producer','profound','progress',
    'prohibit','projects','promised','promoted','promoter','properly','property','proposal','proposer','prospect',
    'protocol','provider','province','prudence','publicly','purchase','pursuant','quantity','quotient','railway',
    'rainfall','rational','reaction','realized','rebuild','recalled','recycled','redirect','referral','refined',
    'reforms','regional','regulate','rejected','relation','relative','released','remained','remember','reminded',
    'renamed','rendered','repeated','replaced','reported','republic','required','research','reserved','resident',
    'resigned','resolves','resource','response','restored','restrict','retailer','retired','returned','revealed',
    'reversed','revision','rigorous','romantic','rounding','sampling','sanction','sandwich','scandal','scenery',
    'schedule','scissors','sealed','seasonal','securely','selected','senator','sequence','sergeant','severely',
    'shipment','shortage','sidewalk','situated','skeleton','slightly','slippery','snowfall','soccer','socially',
    'software','solitary','somebody','somewhat','southern','speaking','specimen','sporting','standard','steadily',
    'sterling','stimulus','stopping','straight','stranger','strategy','strength','stressed','strictly','striking',
    'strongly','struggle','stunning','suburban','suddenly','suffered','suitable','superior','supplier','suppress',
    'surgery','surprise','surround','survival','sweater','symbolic','sympathy','syndrome','teenager','template',
    'textbook','thankful','theology','thinking','thriller','tomorrow','touching','transit','treasure','tribunal',
    'trigger','triumph','tropical','turnover','twisted','umbrella','undergo','universe','unlikely','updating',
    'upgraded','uprising','vacation','velocity','villager','volcanic','voyage','warfare','warnings','wealthy',
    'whistle','wildlife','willow','windows','witches','woodland','workshop','yelling','youthful','zeppelin',
    'zodiac'
  ];

  var DICTSET = Object.create(null);
  (function () {
    for (var i = 0; i < DICT.length; i++) DICTSET[DICT[i]] = true;
  })();

  /* ---------------- seed pool ---------------- */

  function countsOf(word) {
    var m = Object.create(null);
    for (var i = 0; i < word.length; i++) m[word[i]] = (m[word[i]] || 0) + 1;
    return m;
  }

  function canForm(word, counts) {
    var need = countsOf(word);
    for (var k in need) {
      if (!(counts[k] >= need[k])) return false;
    }
    return true;
  }

  var SEED_POOL = [];
  (function buildSeedPool() {
    for (var i = 0; i < DICT.length; i++) {
      var seed = DICT[i];
      if (seed.length !== 7) continue;
      var counts = countsOf(seed);
      var n = 0;
      for (var j = 0; j < DICT.length; j++) {
        var w = DICT[j];
        if (w.length < 3 || w.length > 6 || w === seed) continue;
        if (canForm(w, counts)) n++;
      }
      if (n >= 8) SEED_POOL.push(seed);
    }
    if (!SEED_POOL.length) {
      for (i = 0; i < DICT.length; i++) {
        if (DICT[i].length === 7) SEED_POOL.push(DICT[i]);
      }
    }
    if (!SEED_POOL.length) SEED_POOL.push('planet');
  })();

  /* ---------------- layout ---------------- */

  var TILE_W = 62, TILE_H = 68, TILE_GAP = 12, TILES_Y = 56;
  var ANS_W = 54, ANS_H = 60, ANS_GAP = 8, ANS_Y = 146;

  function tileRect(i) {
    var total = 7 * TILE_W + 6 * TILE_GAP;
    var x0 = (W - total) / 2;
    return { x: x0 + i * (TILE_W + TILE_GAP), y: TILES_Y, w: TILE_W, h: TILE_H };
  }

  function answerRect(i, count) {
    var n = Math.max(count, 1);
    var total = n * ANS_W + (n - 1) * ANS_GAP;
    var x0 = (W - total) / 2;
    return { x: x0 + i * (ANS_W + ANS_GAP), y: ANS_Y, w: ANS_W, h: ANS_H };
  }

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var time = ROUND_TIME, round = 1;
  var seed = '', lastSeed = '';
  var tiles = [];                 /* { ch } — order is the visual scramble */
  var answer = [];                /* { ch, tile|null } */
  var foundByLen = { 3: [], 4: [], 5: [], 6: [], 7: [] };
  var foundSet = Object.create(null);
  var wordsFound = 0, bestWord = '', bestWordPts = 0;
  var streak = 0;
  var toastMsg = '', toastGood = true, toastT = 0;
  var shakeT = 0;
  var particles = [];
  var lastHud = '';
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shuffleArr(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rand(i + 1), t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function multiplier() {
    if (streak >= 6) return 3;
    if (streak >= 3) return 2;
    return 1;
  }

  function currentWord() {
    var s = '';
    for (var i = 0; i < answer.length; i++) s += answer[i].ch;
    return s;
  }

  function tileUsed(t) {
    for (var i = 0; i < answer.length; i++) {
      if (answer[i].tile === t) return true;
    }
    return false;
  }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 40 + Math.random() * 210;
      var life = 0.35 + Math.random() * 0.5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.4,
        col: col
      });
    }
    if (particles.length > 260) particles.splice(0, particles.length - 260);
  }

  /* ---------------- rounds ---------------- */

  function pickSeed() {
    var s = SEED_POOL[rand(SEED_POOL.length)];
    var tries = 0;
    while (SEED_POOL.length > 1 && s === lastSeed && tries < 25) {
      s = SEED_POOL[rand(SEED_POOL.length)];
      tries++;
    }
    return s;
  }

  function newRound() {
    seed = pickSeed();
    lastSeed = seed;
    tiles = [];
    for (var i = 0; i < seed.length; i++) tiles.push({ ch: seed.charAt(i) });
    shuffleArr(tiles);
    answer = [];
    foundByLen = { 3: [], 4: [], 5: [], 6: [], 7: [] };
    foundSet = Object.create(null);
    wordsFound = 0;
    bestWord = '';
    bestWordPts = 0;
    streak = 0;
    toastT = 0;
    shakeT = 0;
    time = ROUND_TIME;
    lastHud = '';
  }

  function start() {
    score = 0;
    round = 1;
    newRound();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function nextRound() {
    round++;
    newRound();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The tiles will hold their places.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Words', value: wordsFound },
        { label: 'Time', value: Math.ceil(time) + 's' }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : "Time's up",
      msg: 'Round ' + round + ' nets you ' + wordsFound + ' word' +
           (wordsFound === 1 ? '' : 's') + '. Ready to unscramble again?',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Words found', value: wordsFound },
        { label: 'Best word', value: bestWord || '—' }
      ],
      btn: '▶ Next round',
      action: nextRound
    });
  }

  /* ---------------- submit / feedback ---------------- */

  function showToast(msg, good) {
    toastMsg = msg;
    toastGood = !!good;
    toastT = 1.4;
  }

  function reject(msg) {
    streak = 0;
    shakeT = 0.5;
    showToast(msg, false);
    updateHud();
  }

  function submit() {
    if (state !== 'running') return;
    var w = currentWord();
    if (w.length < 3) {
      reject('Too short — 3 letters minimum');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(foundSet, w)) {
      reject('Already found: ' + w);
      return;
    }
    if (!canForm(w, countsOf(seed))) {
      reject('Needs tiles you do not have');
      return;
    }
    if (!DICTSET[w]) {
      reject('Not in list');
      return;
    }
    /* valid word */
    var mult = multiplier();
    var pts = SCORES[w.length] * mult;
    score += pts;
    streak++;
    foundSet[w] = true;
    foundByLen[w.length].push(w);
    wordsFound++;
    if (pts > bestWordPts || (pts === bestWordPts && w < bestWord)) {
      bestWord = w;
      bestWordPts = pts;
    }
    showToast('+' + pts + (mult > 1 ? '  ×' + mult : '') + '  ' + w, true);
    burst(W / 2, ANS_Y + ANS_H / 2, '#2ee6a6', 16);
    answer = [];
    updateHud();
  }

  function typeLetter(ch) {
    if (state !== 'running') return;
    if (answer.length >= 7) return;
    answer.push({ ch: ch, tile: null });
  }

  function backspace() {
    if (state !== 'running') return;
    answer.pop();
  }

  function clearAnswer() {
    if (state !== 'running') return;
    answer = [];
  }

  function shuffleTiles() {
    if (state !== 'running') return;
    shuffleArr(tiles);
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    var hint = state === 'paused' ? '⏸ Paused · round ' + round
             : 'Type or tap tiles · Enter = submit';
    var key = state + '|' + score + '|' + Math.ceil(time) + '|' + wordsFound + '|' + hint;
    if (key === lastHud) return;
    lastHud = key;
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Time: Math.ceil(time) + 's',
        Words: wordsFound
      },
      hint
    );
  }

  /* ---------------- update / draw ---------------- */

  function update(dt) {
    var i;
    if (toastT > 0) toastT = Math.max(0, toastT - dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.965;
      p.vy *= 0.965;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state === 'running') {
      time -= dt;
      if (time <= 0) {
        time = 0;
        updateHud();
        gameOver();
        return;
      }
      updateHud();
    }
  }

  function drawTile(x, y, w, h, ch, opts) {
    opts = opts || {};
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    rr(x, y, w, h, 10);
    ctx.fillStyle = opts.glow ? 'rgba(124,92,255,.22)' : '#131c30';
    ctx.fill();
    ctx.lineWidth = opts.glow ? 2 : 1;
    ctx.strokeStyle = opts.glow ? '#7c5cff' : (opts.dim ? '#22304d' : '#2a3b5f');
    ctx.stroke();
    ctx.fillStyle = opts.dim ? '#5b6b8c' : '#e8eefc';
    ctx.font = 'bold ' + Math.round(h * 0.5) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x + w / 2, y + h / 2 + 1);
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    var i, j;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 30, 10, W * 0.5, 30, W * 0.9);
    g.addColorStop(0, 'rgba(34,211,238,.16)');
    g.addColorStop(0.5, 'rgba(124,92,255,.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* ---- top strip ---- */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px ' + FONT;
    ctx.fillStyle = '#e8eefc';
    ctx.fillText('ROUND ' + round, 40, 20);
    var mult = multiplier();
    if (mult > 1 && state === 'running') {
      ctx.fillStyle = '#2ee6a6';
      ctx.fillText('STREAK ×' + mult, 130, 20);
    }

    /* timer bar */
    ctx.fillStyle = '#121a2c';
    rr(40, 33, 520, 7, 3.5);
    ctx.fill();
    var frac = clamp(time / ROUND_TIME, 0, 1);
    var low = time < 15;
    if (low && Math.floor(t / 250) % 2 === 0) ctx.fillStyle = '#ff5c7a';
    else ctx.fillStyle = low ? '#ff8ba1' : '#22d3ee';
    if (frac > 0) { rr(40, 33, Math.max(8, 520 * frac), 7, 3.5); ctx.fill(); }

    /* ---- seed tiles ---- */
    for (i = 0; i < tiles.length; i++) {
      var r0 = tileRect(i);
      var used = tileUsed(tiles[i]);
      drawTile(r0.x, r0.y, r0.w, r0.h, tiles[i].ch,
               used ? { dim: true, glow: true, alpha: 0.55 } : {});
    }

    /* ---- answer strip (shake on reject) ---- */
    var shakeX = shakeT > 0 ? Math.sin(t / 28) * 10 * (shakeT / 0.5) : 0;
    ctx.save();
    ctx.translate(shakeX, 0);
    if (!answer.length) {
      ctx.font = '15px ' + FONT;
      ctx.fillStyle = '#93a3c2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('type or tap tiles to build a word', W / 2, ANS_Y + ANS_H / 2);
    } else {
      for (i = 0; i < answer.length; i++) {
        var ra = answerRect(i, answer.length);
        drawTile(ra.x, ra.y, ra.w, ra.h, answer[i].ch, { glow: true });
      }
    }
    ctx.restore();

    /* ---- worth preview or toast ---- */
    if (toastT > 0) {
      var wText = toastMsg;
      ctx.font = 'bold 15px ' + FONT;
      var tw = ctx.measureText(wText).width + 28;
      ctx.globalAlpha = clamp(toastT / 0.3, 0, 1);
      rr(W / 2 - tw / 2, 218, tw, 30, 15);
      ctx.fillStyle = toastGood ? 'rgba(46,230,166,.16)' : 'rgba(255,92,122,.16)';
      ctx.fill();
      ctx.strokeStyle = toastGood ? '#2ee6a6' : '#ff5c7a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = toastGood ? '#2ee6a6' : '#ff9db4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(wText, W / 2, 234);
      ctx.globalAlpha = 1;
    } else if (state === 'running' && answer.length >= 3) {
      var pts = (SCORES[answer.length] || 0) * multiplier();
      ctx.font = '14px ' + FONT;
      ctx.fillStyle = '#93a3c2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('worth ' + pts + ' points' + (multiplier() > 1 ? ' (×' + multiplier() + ')' : ''),
                   W / 2, 233);
    }

    /* ---- divider ---- */
    ctx.strokeStyle = '#1c2a45';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 258);
    ctx.lineTo(560, 258);
    ctx.stroke();

    /* ---- found words, grouped by length ---- */
    var y = 274;
    ctx.textAlign = 'left';
    for (var len = 3; len <= 7; len++) {
      var ws = foundByLen[len];
      if (!ws.length) continue;
      ctx.font = 'bold 12px ' + FONT;
      ctx.fillStyle = '#93a3c2';
      ctx.fillText(ws.length + ' LETTER' + (ws.length === 1 ? '' : 'S') + ' · ' +
                   (SCORES[len] || 0) + ' PTS EACH', 40, y + 8);
      y += 18;
      ctx.font = 'bold 13px ' + FONT;
      var px = 40;
      for (i = 0; i < ws.length; i++) {
        var pw = Math.max(50, ctx.measureText(ws[i]).width + 20);
        if (px + pw > 560) { px = 40; y += 27; }
        rr(px, y, pw, 22, 11);
        ctx.fillStyle = 'rgba(34,211,238,.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34,211,238,.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#e8eefc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ws[i], px + pw / 2, y + 12);
        ctx.textAlign = 'left';
        px += pw + 6;
      }
      y += 32;
      if (y > 560) {
        ctx.font = '12px ' + FONT;
        ctx.fillStyle = '#93a3c2';
        ctx.fillText('…and more kept below the board', 40, y);
        break;
      }
    }
    if (!wordsFound) {
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = '#93a3c2';
      ctx.textAlign = 'center';
      ctx.fillText('Every word you bank appears here, grouped by length.',
                   W / 2, 290);
    }

    /* ---- particles ---- */
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 585);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running' || toastT > 0 || shakeT > 0 || particles.length) update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pointFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    return { x: x, y: y };
  }

  function inRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    var p = pointFromEvent(ev);
    if (!p) return;
    if (ev.preventDefault) ev.preventDefault();

    /* tap a placed tile in the answer strip → return it */
    for (var i = answer.length - 1; i >= 0; i--) {
      if (inRect(p, answerRect(i, answer.length))) {
        answer.splice(i, 1);
        return;
      }
    }
    /* tap a tile in the row → place it, or return it if already placed */
    for (i = 0; i < tiles.length; i++) {
      if (inRect(p, tileRect(i))) {
        if (tileUsed(tiles[i])) {
          for (var j = answer.length - 1; j >= 0; j--) {
            if (answer[j].tile === tiles[i]) { answer.splice(j, 1); return; }
          }
        } else if (answer.length < 7) {
          answer.push({ ch: tiles[i].ch, tile: tiles[i] });
        }
        return;
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'Escape' ||
        k === 'Backspace' || k === 'ArrowLeft' || k === 'ArrowRight') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'Escape') {
      /* Escape always toggles pause — it is never a typed letter. */
      if (state === 'running') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (k === 'p' || k === 'P') {
      /* Pause key: only pauses while the answer strip is empty so that
         every letter of the alphabet can still be typed mid-word. */
      if (state === 'running' && answer.length > 0) {
        if (k === 'p' || k === 'P') typeLetter('p');
      } else if (state === 'running') {
        pause();
      } else if (state === 'paused') {
        resume();
      }
      return;
    }
    if (k === ' ') {
      if (state === 'ready') start();
      else if (state === 'over') nextRound();
      else if (state === 'paused') resume();
      return;
    }
    if (k === 'Enter') {
      /* Enter submits while running — it never pauses. */
      if (state === 'running') submit();
      else if (state === 'ready') start();
      else if (state === 'over') nextRound();
      return;
    }
    if (k === 'Backspace') {
      backspace();
      return;
    }
    if (k && k.length === 1) {
      var ch = k.toLowerCase();
      if (ch >= 'a' && ch <= 'z') typeLetter(ch);
    }
  });

  var actBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < actBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      btn.addEventListener('click', function () {
        if (act === 'submit') {
          if (state === 'ready') { start(); return; }
          if (state === 'over') { nextRound(); return; }
          submit();
        } else if (act === 'shuffle') {
          shuffleTiles();
        } else if (act === 'clear') {
          clearAnswer();
        }
      });
    })(actBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  newRound();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Anagram Ace',
    msg: 'Seven tiles, one hidden seed word and 90 seconds. Type or tap words of 3+ letters, chain the streak multiplier and beat your best.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* Read-only debug/verification hook (frozen). */
  window.__anagramAce = Object.freeze({
    get state() { return state; },
    get score() { return score; },
    get time() { return time; },
    get round() { return round; },
    get seed() { return seed; },
    get tiles() { return tiles.map(function (t) { return t.ch; }).join(''); },
    get answer() { return currentWord(); },
    get wordsFound() { return wordsFound; },
    get foundWords() {
      var out = [];
      for (var len = 3; len <= 7; len++) out = out.concat(foundByLen[len]);
      return out;
    },
    get bestWord() { return bestWord; },
    get streak() { return streak; },
    get multiplier() { return multiplier(); },
    get lastToast() { return toastMsg; },
    get seedPoolSize() { return SEED_POOL.length; },
    validWords: function () {
      var counts = countsOf(seed);
      var out = [];
      for (var i = 0; i < DICT.length; i++) {
        var w = DICT[i];
        if (w.length < 3 || w.length > 7) continue;
        if (canForm(w, counts)) out.push(w);
      }
      return out;
    },
    geometry: Object.freeze({
      w: W, h: H,
      tileRect: function (i) { var r = tileRect(i); return { x: r.x, y: r.y, w: r.w, h: r.h }; }
    })
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
