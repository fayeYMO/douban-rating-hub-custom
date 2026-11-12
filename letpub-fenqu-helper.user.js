// ==UserScript==
// @name         LetPub 分区助手(划词查分区 + 学术搜索自动标注)
// @namespace    lp.fenqu.helper
// @version      1.1.0
// @description  ① 任意网页(含 LetPub 本站)划词后点「查分区」按钮:期刊显示新锐/中科院各版本分区、JCR、CCF 期刊等级(第七版内嵌)、Top、预警、IF、审稿周期等,会议自动匹配 CCF 推荐等级;② 在 Google Scholar(含镜像)、百度学术、DBLP 的搜索结果里自动给期刊/会议名标注分区徽标。面板可拖动,数据缓存 30 天,限速访问 LetPub。
// @author       faye
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      letpub.com.cn
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ============================== 配置 ============================== */

  const CFG = {
    enableSelectionButton: true,   // 划词后显示「查分区」悬浮按钮
    enableAutoBadges: true,        // 学术搜索站点自动注入分区徽标
    requestGapMs: 1500,            // 相邻两次 LetPub 请求最小间隔(限速)
    cacheTTLms: 30 * 864e5,        // 查询结果缓存 30 天
    cacheMax: 800,                 // 缓存条目上限
    cooldownMs: 10 * 60e3,         // 触发 LetPub 风控后的冷却时间
    showUnmatched: false,          // 未收录时是否也显示灰色徽标
    debug: false
  };

  /* >>> PURE-LOGIC >>> */

  // CCF 推荐国际学术目录(第七版,2026-03-31 发布,西南交大手册计分口径同源 ccf.atom.im)。
  // 数据源: github.com/atom-im/ccf(第七版),构建时内嵌,离线可用。字段: a=缩写  n=全称  r=等级  c=领域
  const CCF_CONFS = [{"a":"3DV","n":"International Conference on 3D Vision","r":"C","c":"计算机图形学与多媒体"},{"a":"AAAI","n":"AAAI Conference on Artificial Intelligence","r":"A","c":"人工智能"},{"a":"AAMAS","n":"International Joint Conference on Autonomous Agents and Multi-agent Systems","r":"B","c":"人工智能"},{"a":"ACCV","n":"Asian Conference on Computer Vision","r":"C","c":"人工智能"},{"a":"ACISP","n":"AustralasiaConferenceonInformation SecurityandPrivacy","r":"C","c":"网络与信息安全"},{"a":"ACL","n":"Annual Meeting of the Association for Computational Linguistics","r":"A","c":"人工智能"},{"a":"ACM MM","n":"ACM International Conference on Multimedia","r":"A","c":"计算机图形学与多媒体"},{"a":"ACM SIGOPS ATC","n":"ACM SIGOPS Annual Technical Conference","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ACML","n":"Asian Conference on Machine Learning","r":"C","c":"人工智能"},{"a":"ACNS","n":"International Conference on Applied Cryptography and Network Security","r":"C","c":"网络与信息安全"},{"a":"ACSAC","n":"Annual Computer Security Applications Conference","r":"B","c":"网络与信息安全"},{"a":"ADMA","n":"International Conference on Advanced Data Mining and Applications","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"AFT","n":"Advances in Financial Technologies","r":"C","c":"交叉/综合/新兴"},{"a":"AISTATS","n":"International Conference on Artificial Intelligence and Statistics","r":"C","c":"人工智能"},{"a":"ALT","n":"International Conference on Algorithmic Learning Theory","r":"C","c":"人工智能"},{"a":"AMIA","n":"American Medical Informatics Association Annual Symposium","r":"C","c":"交叉/综合/新兴"},{"a":"ANCS","n":"ACM/IEEE Symposium on Architectures for Networking and Communication Systems","r":"C","c":"计算机网络"},{"a":"APBC","n":"Asia Pacific Bioinformatics Conference","r":"C","c":"交叉/综合/新兴"},{"a":"APLAS","n":"Asian Symposium on Programming Languages and Systems","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"APNet","n":"Asia-Pacific Workshop on Networking","r":"C","c":"计算机网络"},{"a":"APNOMS","n":"Asia-Pacific Network Operations and Management Symposium","r":"C","c":"计算机网络"},{"a":"APPT","n":"International Symposium on Advanced Parallel Processing Technology","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"APSEC","n":"Asia-Pacific Software Engineering Conference","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"APWeb","n":"Asia Pacific Web Conference","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"ASAP","n":"IEEE International Conference on Application-Specific Systems, Architectures, and Processors","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ASE","n":"International Conference on Automated Software Engineering","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"AsiaCCS","n":"ACM Asia Conference on Computer and Communications Security","r":"C","c":"网络与信息安全"},{"a":"ASIACRYPT","n":"Annual International Conference on the Theory and Application of Cryptology and Information Security","r":"B","c":"网络与信息安全"},{"a":"ASP-DAC","n":"Asia and South Pacific Design Automation Conference","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ASPLOS","n":"International Conference on Architectural Support for Programming Languages and Operating Systems","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ASRU","n":"Automatic Speech Recognition and Understanding Workshop","r":"C","c":"计算机图形学与多媒体"},{"a":"ASSETS","n":"International ACM SIGACCESS Conference on Computers and Accessibility","r":"C","c":"人机交互与普适计算"},{"a":"ATS","n":"IEEE Asian Test Symposium","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ATVA","n":"International Symposium on Automated Technology for Verification and Analysis","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"AVI","n":"International Working Conference on Advanced Visual Interfaces","r":"C","c":"人机交互与普适计算"},{"a":"BIBM","n":"IEEE International Conference on Bioinformatics and Biomedicine","r":"B","c":"交叉/综合/新兴"},{"a":"BlockSys","n":"International Conference on Blockchain, Artificial Intelligence, and Trustworthy Systems","r":"C","c":"网络与信息安全"},{"a":"BMVC","n":"British Machine Vision Conference","r":"C","c":"人工智能"},{"a":"CAD/Graphics","n":"International Conference on Computer-Aided Design and Computer Graphics","r":"C","c":"计算机图形学与多媒体"},{"a":"CADE","n":"Conference on Automated Deduction","r":"B","c":"计算机科学理论"},{"a":"CAiSE","n":"International Conference on Advanced Information Systems Engineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"CASAXR","n":"International Conference on Computer Animation, Social Agents, and Extended Reality","r":"C","c":"计算机图形学与多媒体"},{"a":"CASES","n":"International Conference on Compilers, Architectures, and Synthesis for Embedded Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CAV","n":"International Conference on Computer Aided Verification","r":"A","c":"计算机科学理论"},{"a":"CC","n":"International Conference on Compiler Construction","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"CCC","n":"Conference on Computational Complexity","r":"B","c":"计算机科学理论"},{"a":"CCGRID","n":"IEEE/ACM International Symposium on Cluster, Cloud and Grid Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CCS","n":"ACM Conference on Computer and Communications Security","r":"A","c":"网络与信息安全"},{"a":"CF","n":"ACM International Conference on Computing Frontiers","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CGI","n":"Computer Graphics International","r":"C","c":"计算机图形学与多媒体"},{"a":"CGO","n":"The International Symposium on Code Generation and Optimization","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CHES","n":"International Conference on Cryptographic Hardware and Embedded Systems","r":"B","c":"网络与信息安全"},{"a":"CHI","n":"ACM Conference on Human Factors in Computing Systems","r":"A","c":"人机交互与普适计算"},{"a":"CIDR","n":"Conference on Innovative DataSystems Research","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"CIKM","n":"ACM International Conference on Information and Knowledge Management","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"CLUSTER","n":"IEEE International Conference on Cluster Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"COCOON","n":"International Computing and Combinatorics Conference","r":"B","c":"计算机科学理论"},{"a":"CODASPY","n":"Conference on Data and Application Security and Privacy","r":"C","c":"网络与信息安全"},{"a":"CODES+ISSS","n":"International Conference on Hardware/Software Co-design and System Synthesis","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CogSci","n":"Annual Meeting of the Cognitive Science Society","r":"B","c":"交叉/综合/新兴"},{"a":"COLING","n":"International Conference on Computational Linguistics","r":"B","c":"人工智能"},{"a":"CollaborateCom","n":"International Conference on Collaborative Computing:Networking, Applications and Worksharing","r":"C","c":"人机交互与普适计算"},{"a":"COLT","n":"Annual Conference on Computational Learning Theory","r":"B","c":"人工智能"},{"a":"COMPSAC","n":"International Computer Software and Applications Conference","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"CONCUR","n":"International Conference on Concurrency Theory","r":"B","c":"计算机科学理论"},{"a":"CoNEXT","n":"ACM International Conference on emerging Networking EXperiments and Technologies","r":"B","c":"计算机网络"},{"a":"CoNLL","n":"Conference on Computational Natural Language Learning","r":"C","c":"人工智能"},{"a":"CoopIS","n":"International Conference on Cooperative Information Systems","r":"C","c":"人机交互与普适计算"},{"a":"COSIT","n":"International Conference on Spatial Information Theory","r":"C","c":"交叉/综合/新兴"},{"a":"CP","n":"International Conference on Principles and Practice of Constraint Programming","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"CRYPTO","n":"International Cryptology Conference","r":"A","c":"网络与信息安全"},{"a":"CSCloud","n":"International Conference on Cyber Security and Cloud Computing","r":"C","c":"网络与信息安全"},{"a":"CSCW","n":"ACM Conference on Computer Supported Cooperative Work and Social Computing","r":"A","c":"人机交互与普适计算"},{"a":"CSCWD","n":"International Conference on Computer Supported Cooperative Work in Design","r":"C","c":"人机交互与普适计算"},{"a":"CSFW","n":"IEEE Computer Security Foundations Workshop","r":"B","c":"网络与信息安全"},{"a":"CSL","n":"Computer Science Logic","r":"C","c":"计算机科学理论"},{"a":"CT-RSA","n":"The Cryptographer's Track at RSA Conference","r":"C","c":"网络与信息安全"},{"a":"CVM","n":"Computational Visual Media","r":"C","c":"计算机图形学与多媒体"},{"a":"CVPR","n":"IEEE/CVF Computer Vision and Pattern Recognition Conference","r":"A","c":"人工智能"},{"a":"DAC","n":"Design Automation Conference","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"DAI","n":"International Conference on Distributed Artificial Intelligence","r":"C","c":"人工智能"},{"a":"DASFAA","n":"International Conference on Database Systems for Advanced Applications","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"DATE","n":"Design, Automation & Test in Europe","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"DCC","n":"Data Compression Conference","r":"B","c":"计算机图形学与多媒体"},{"a":"DEXA","n":"International Conference on Database and Expert System Applications","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"DFRWS","n":"Digital Forensic Research Workshop","r":"C","c":"网络与信息安全"},{"a":"DIMVA","n":"Conference on Detection of Intrusions and Malware & VulnerabilityAssessment","r":"C","c":"网络与信息安全"},{"a":"DIS","n":"ACM SIGCHI Conference on Designing Interactive Systems","r":"C","c":"人机交互与普适计算"},{"a":"DRM","n":"ACM Workshop on Digital Rights Management","r":"C","c":"网络与信息安全"},{"a":"DSAA","n":"IEEE International Conference on Data Science and Advanced Analytics","r":"C","c":"计算机科学理论"},{"a":"DSN","n":"International Conference on Dependable Systems and Networks","r":"B","c":"网络与信息安全"},{"a":"EASE","n":"International Conference on Evaluation and Assessment in Software Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ECAI","n":"European Conference on Artificial Intelligence","r":"B","c":"人工智能"},{"a":"ECCV","n":"European Conference on Computer Vision","r":"B","c":"人工智能"},{"a":"ECIR","n":"European Conference on Information Retrieval","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"ECML-PKDD","n":"European Conference on Machine Learning and Principles and Practice of Knowledge Discovery in Databases","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"ECOOP","n":"European Conference on Object-Oriented Programming","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ECSCW","n":"European Conference on Computer Supported Cooperative Work","r":"B","c":"人机交互与普适计算"},{"a":"EDBT","n":"International Conference on Extending DatabaseTechnology","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"EGSR","n":"Eurographics Symposium on Rendering","r":"B","c":"计算机图形学与多媒体"},{"a":"EMNLP","n":"Conference on Empirical Methods in Natural Language Processing","r":"B","c":"人工智能"},{"a":"EMSOFT","n":"International Conference on Embedded Software","r":"B","c":"交叉/综合/新兴"},{"a":"ER","n":"International Conference on Conceptual Modeling","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"ESA","n":"European Symposium on Algorithms","r":"B","c":"计算机科学理论"},{"a":"ESEM","n":"International Symposium on Empirical Software Engineering and Measurement","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ESORICS","n":"European Symposium on Research in Computer Security","r":"B","c":"网络与信息安全"},{"a":"ESWC","n":"Extended Semantic Web Conference","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"ETAPS","n":"European Joint Conferences on Theory and Practice of Software","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ETS","n":"IEEE European Test Symposium","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"Euro-Par","n":"European Conference on Parallel and Distributed Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"EUROCRYPT","n":"International Conference on the Theory and Applications of Cryptographic Techniques","r":"A","c":"网络与信息安全"},{"a":"Eurographics","n":"Annual Conference of the European Association for Computer Graphics","r":"B","c":"计算机图形学与多媒体"},{"a":"EuroS&P","n":"IEEE European Symposium on Security and Privacy","r":"C","c":"网络与信息安全"},{"a":"EuroSys","n":"European Conference on Computer Systems","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"EuroVis","n":"Eurographics Conference on Visualization","r":"B","c":"计算机图形学与多媒体"},{"a":"FAST","n":"USENIX Conference on File and Storage Technologies","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FC","n":"Financial Cryptography and Data Security","r":"C","c":"网络与信息安全"},{"a":"FCCM","n":"IEEE Symposium on Field-Programmable Custom Computing Machines","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FG","n":"IEEE International Conference on AutomaticFace and Gesture Recognition","r":"C","c":"人工智能"},{"a":"FM","n":"International Symposium on Formal Methods","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"FMCAD","n":"Formal Methods in Computer-Aided Design","r":"B","c":"计算机科学理论"},{"a":"FOCS","n":"IEEE Annual Symposium on Foundations of Computer Science","r":"A","c":"计算机科学理论"},{"a":"FORTE","n":"International Conference on Formal Techniques for Distributed Objects, Components, and Systems","r":"C","c":"计算机网络"},{"a":"FPGA","n":"ACM/SIGDA International Symposium on Field-Programmable Gate Arrays","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FPL","n":"International Conference on Field-Programmable Logic and Applications","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FPT","n":"International Conference on Field-Programmable Technology","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FSCD","n":"International Conference on Formal Structures for Computation and Deduction","r":"C","c":"计算机科学理论"},{"a":"FSE","n":"Fast Software Encryption","r":"B","c":"网络与信息安全"},{"a":"FSTTCS","n":"Foundations of Software Technology and Theoretical Computer Science","r":"C","c":"计算机科学理论"},{"a":"GECCO","n":"Genetic and Evolutionary Computation Conference","r":"C","c":"人工智能"},{"a":"GI","n":"Graphics Interface","r":"C","c":"人机交互与普适计算"},{"a":"GLOBECOM","n":"IEEE Global Communications Conference","r":"C","c":"计算机网络"},{"a":"GLSVLSI","n":"Great Lakes Symposium on VLSI","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"GMP","n":"Geometric Modeling and Processing","r":"C","c":"计算机图形学与多媒体"},{"a":"GPC","n":"Conference on Green, Pervasive and Cloud Computing","r":"C","c":"人机交互与普适计算"},{"a":"GROUP","n":"ACM International Conference on Supporting Group Work","r":"B","c":"人机交互与普适计算"},{"a":"HiPC","n":"IEEE International Conference on High Performance Computing, Data and Analytics","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HiPEAC","n":"International Conference on High Performance and Embedded Architectures and Compilers","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HOT CHIPS","n":"Hot Chips: A Symposium on High Performance Chips","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HOTI","n":"IEEE Symposium on High-Performance Interconnects","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HotNets","n":"ACM The Workshop on Hot Topics in Networks","r":"C","c":"计算机网络"},{"a":"HotOS","n":"USENIX Workshop on Hot Topics in Operating Systems","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"HotSec","n":"USENIX Workshop on Hot Topics in Security","r":"C","c":"网络与信息安全"},{"a":"HotStorage","n":"Hot Topics in Storage and File Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HPCA","n":"IEEE International Symposium on High Performance Computer Architecture","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HPCC","n":"IEEE International Conference on High Performance Computing and Communications","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HPDC","n":"The International ACM Symposium on High-Performance Parallel and Distributed Computing","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"HSCC","n":"International Conference on Hybrid Systems: Computation and Control","r":"B","c":"计算机科学理论"},{"a":"I3D","n":"ACM SIGGRAPH Symposium onInteractive 3D Graphics and Games","r":"B","c":"计算机图形学与多媒体"},{"a":"ICA3PP","n":"International Conference on Algorithms and Architectures for Parallel Processing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICALP","n":"International Colloquium on Automata, Languages and Programming","r":"B","c":"计算机科学理论"},{"a":"ICANN","n":"International Conference on Artificial Neural Networks","r":"C","c":"人工智能"},{"a":"ICAPS","n":"International Conference on Automated Planning and Scheduling","r":"B","c":"人工智能"},{"a":"ICASSP","n":"IEEE International Conference on Acoustics,Speech and Signal Processing","r":"B","c":"计算机图形学与多媒体"},{"a":"ICC","n":"IEEE International Conference on Communications","r":"C","c":"计算机网络"},{"a":"ICCAD","n":"International Conference on Computer-Aided Design","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICCBR","n":"International Conference on Case-Based Reasoning","r":"B","c":"人工智能"},{"a":"ICCCN","n":"IEEE International Conference on Computer Communications and Networks","r":"C","c":"计算机网络"},{"a":"ICCD","n":"International Conference on Computer Design","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICCV","n":"International Conference on Computer Vision","r":"A","c":"人工智能"},{"a":"ICDAR","n":"International Conference on Document Analysis and Recognition","r":"C","c":"人工智能"},{"a":"ICDCS","n":"IEEE International Conference on Distributed Computing Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICDE","n":"IEEE International Conference on Data Engineering","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"ICDF2C","n":"International Conference on Digital Forensics & Cyber Crime","r":"C","c":"网络与信息安全"},{"a":"ICDM","n":"IEEE International Conference on Data Mining","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"ICDT","n":"International Conference on Database Theory","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"ICECCS","n":"International Conference on Engineering of Complex Computer Systems","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICFEM","n":"International Conference on Formal Engineering Methods","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICFP","n":"ACM SIGPLAN International Conference on Function Programming","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ICIC","n":"International Conference on Intelligent Computing","r":"C","c":"交叉/综合/新兴"},{"a":"ICICS","n":"International Conference on Information and Communications Security","r":"C","c":"网络与信息安全"},{"a":"ICIG","n":"International Conference on Image and Graphics","r":"C","c":"计算机图形学与多媒体"},{"a":"ICIP","n":"IEEE International Conference on Image Processing","r":"C","c":"计算机图形学与多媒体"},{"a":"ICLR","n":"International Conference on Learning Representations","r":"A","c":"人工智能"},{"a":"ICME","n":"IEEE International Conference on Multimedia& Expo","r":"B","c":"计算机图形学与多媒体"},{"a":"ICMI","n":"ACM International Conference on Multimodal Interaction","r":"C","c":"人机交互与普适计算"},{"a":"ICML","n":"International Conference on Machine Learning","r":"A","c":"人工智能"},{"a":"ICMR","n":"ACM SIGMM International Conference on Multimedia Retrieval","r":"B","c":"计算机图形学与多媒体"},{"a":"ICNP","n":"IEEE International Conference on Network Protocols","r":"B","c":"计算机网络"},{"a":"ICONIP","n":"International Conference on Neural Information Processing","r":"C","c":"人工智能"},{"a":"ICPADS","n":"International Conference on Parallel and Distributed Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICPC","n":"IEEE International Conference on Program Comprehension","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ICPP","n":"International Conference on Parallel Processing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICPR","n":"International Conference on Pattern Recognition","r":"C","c":"人工智能"},{"a":"ICRA","n":"IEEE International Conference on Robotics and Automation","r":"B","c":"人工智能"},{"a":"ICS","n":"International Conference on Supercomputing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ICSE","n":"International Conference on Software Engineering","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"ICSME","n":"International Conference on Software Maintenance and Evolution","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ICSOC","n":"International Conference on Service Oriented Computing","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ICSR","n":"International Conference on Software Reuse","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICSS","n":"International Conference on Service Science","r":"C","c":"交叉/综合/新兴"},{"a":"ICSSP","n":"International Conference on Software and System Process","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICST","n":"IEEE International Conference on Software Testing, Verification and Validation","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICTAC","n":"International Colloquium on Theoretical Aspects of Computing","r":"C","c":"计算机科学理论"},{"a":"ICTAI","n":"IEEE International Conference on Tools with Artificial Intelligence","r":"C","c":"人工智能"},{"a":"ICWE","n":"International Conference on Web Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ICWS","n":"IEEE International Conference on Web Services","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ICWSM","n":"The International AAAI Conference on Web and Social Media","r":"B","c":"人机交互与普适计算"},{"a":"ICXR","n":"CCF International Conference on Extended Reality","r":"C","c":"人机交互与普适计算"},{"a":"IDC","n":"ACM Interaction Design and Children","r":"C","c":"人机交互与普适计算"},{"a":"IEEE BigData","n":"IEEE International Conference on Big Data","r":"C","c":"交叉/综合/新兴"},{"a":"IEEE CEC","n":"Congress on Evolutionary Computation","r":"C","c":"人工智能"},{"a":"IEEE CLOUD","n":"IEEE International Conference on Cloud Computing","r":"C","c":"交叉/综合/新兴"},{"a":"IEEE VIS","n":"IEEE Visualization Conference","r":"A","c":"计算机图形学与多媒体"},{"a":"","n":"IEEE World Haptics Conference","r":"C","c":"人机交互与普适计算"},{"a":"IFIP WG 11.9","n":"IFIP Working Group 11.9 International Conference on Digital Forensics","r":"C","c":"网络与信息安全"},{"a":"IH&MMSec","n":"ACM Workshop on Information Hiding and Multimedia Security","r":"C","c":"网络与信息安全"},{"a":"IJCAI","n":"International Joint Conference on Artificial Intelligence","r":"B","c":"人工智能"},{"a":"IJCB","n":"International Joint Conference onBiometrics","r":"C","c":"人工智能"},{"a":"IJCNN","n":"International Joint Conference on Neural Networks","r":"C","c":"人工智能"},{"a":"IJTCS-FAW","n":"International Joint Conference on Theoretical Computer Science-Frontier of Algorithmic Wisdom","r":"C","c":"交叉/综合/新兴"},{"a":"ILP","n":"International Conference on Inductive Logic Programming","r":"C","c":"人工智能"},{"a":"IM","n":"IFIP/IEEE International Symposium on Integrated NetworkManagement","r":"C","c":"计算机网络"},{"a":"IMC","n":"ACM Internet Measurement Conference","r":"B","c":"计算机网络"},{"a":"INFOCOM","n":"IEEE International Conference on Computer Communications","r":"A","c":"计算机网络"},{"a":"Inscrypt","n":"International Conference on Information Security and Cryptology","r":"C","c":"网络与信息安全"},{"a":"INTERACT","n":"International Conference on Human- Computer Interaction of International Federation for Information Processing","r":"C","c":"人机交互与普适计算"},{"a":"Internetware","n":"Asia-Pacific Symposium on Internetware","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"INTERSPEECH","n":"Conference of the International Speech Communication Association","r":"B","c":"计算机图形学与多媒体"},{"a":"IPCCC","n":"IEEE International Performance Computing and Communications Conference","r":"C","c":"计算机网络"},{"a":"IPCO","n":"International Conference on Integer Programming and Combinatorial Optimization","r":"C","c":"计算机科学理论"},{"a":"IPDPS","n":"IEEE International Parallel & Distributed Processing Symposium","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"IPSN","n":"International Conference on Information Processing in Sensor Networks","r":"B","c":"计算机网络"},{"a":"IROS","n":"IEEE/RSJ International Conference on Intelligent Robots and Systems","r":"C","c":"人工智能"},{"a":"ISAAC","n":"International Symposium on Algorithms and Computation","r":"C","c":"计算机科学理论"},{"a":"ISBRA","n":"International Symposium on Bioinformatics Research and Applications","r":"C","c":"交叉/综合/新兴"},{"a":"ISC","n":"Information Security Conference","r":"C","c":"网络与信息安全"},{"a":"ISCA","n":"International Symposium on Computer Architecture","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ISCAS","n":"IEEE International Symposium on Circuits and Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ISCC","n":"IEEE Symposium on Computers and Communications","r":"C","c":"计算机网络"},{"a":"ISLPED","n":"International Symposium on Low Power Electronics and Design","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ISMAR","n":"International Symposium on Mixed and Augmented Reality","r":"B","c":"计算机图形学与多媒体"},{"a":"ISMB","n":"International conference on Intelligent Systems for Molecular Biology","r":"B","c":"交叉/综合/新兴"},{"a":"ISPA","n":"IEEE International Symposium on Parallel and Distributed Processing with Applications","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ISPASS","n":"IEEE International Symposium on Performance Analysis of Systems and Software","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"ISPD","n":"International Symposium on Physical Design","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ISS","n":"ACM International Conference on Interactive Surfaces and Spaces","r":"B","c":"人机交互与普适计算"},{"a":"ISSRE","n":"IEEE International Symposium on Software Reliability Engineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ISSTA","n":"International Symposium on Software Testing and Analysis","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"ISWC","n":"IEEE International Semantic Web Conference","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"ITC","n":"International Test Conference","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"ITC-Asia","n":"International Test Conference in Asia","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"IUI","n":"ACM International Conference on Intelligent User Interfaces","r":"B","c":"人机交互与普适计算"},{"a":"IWQoS","n":"IEEE/ACM International Workshop on Quality of Service","r":"B","c":"计算机网络"},{"a":"JCC","n":"International Conference on Joint Cloud Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"KR","n":"International Conference on Principles of Knowledge Representation and Reasoning","r":"B","c":"人工智能"},{"a":"KSEM","n":"International conference on Knowledge Science,Engineering and Management","r":"C","c":"人工智能"},{"a":"LCN","n":"IEEE Conference on Local Computer Networks","r":"C","c":"计算机网络"},{"a":"LCTES","n":"ACM SIGPLAN/SIGBED International Conference on Languages, Compilers andTools for Embedded Systems","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"LICS","n":"ACM/IEEE Symposium on Logic in Computer Science","r":"A","c":"计算机科学理论"},{"a":"LISA","n":"Large Installation System Administration Conference","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"LOPSTR","n":"International Symposium on Logic-based Program Synthesis and Transformation","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"MASCOTS","n":"International Symposium on Modeling, Analysis, andSimulation of Computer and Telecommunication Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"MASS","n":"IEEE International Conference on Mobile Ad-hoc and Sensor Systems","r":"C","c":"计算机网络"},{"a":"MDM","n":"International Conference on Mobile Data Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"MEMOCODE","n":"International Conference on Formal Methods and Models for Co-Design","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"MFCS","n":"International Conference on Mathematical Foundations of Computer Science","r":"C","c":"计算机科学理论"},{"a":"MICCAI","n":"International Conference on Medical Image Computing and Computer-Assisted Intervention","r":"B","c":"交叉/综合/新兴"},{"a":"MICRO","n":"IEEE/ACM International Symposium on Microarchitecture","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"Middleware","n":"International Middleware Conference","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"MMAsia","n":"ACM Multimedia Asia","r":"C","c":"计算机图形学与多媒体"},{"a":"MMM","n":"International Conference on Multimedia Modeling","r":"C","c":"计算机图形学与多媒体"},{"a":"MobiCom","n":"ACM International Conference on Mobile Computing and Networking","r":"A","c":"计算机网络"},{"a":"MobiHoc","n":"International Symposium on Theory, Algorithmic Foundations, and Protocol Design for Mobile Networks and Mobile Computing","r":"B","c":"计算机网络"},{"a":"MobileHCI","n":"ACM International Conference on Mobile Human-Computer Interaction","r":"B","c":"人机交互与普适计算"},{"a":"MobiQuitous","n":"International Conference on Mobile and Ubiquitous Systems: Computing,Networking and Services","r":"C","c":"人机交互与普适计算"},{"a":"MobiSys","n":"ACM International Conference on Mobile Systems, Applications, and Services","r":"B","c":"计算机网络"},{"a":"MoDELS","n":"ACM/IEEE International Conference on Model Driven Engineering Languages and Systems","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"MSN","n":"International Conference on Mobility, Sensing and Networking","r":"C","c":"计算机网络"},{"a":"MSR","n":"Mining Software Repositories","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"MSST","n":"Mass Storage Systems and Technologies","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"MSWiM","n":"International Conference on Modeling, Analysis and Simulation of Wireless and Mobile Systems","r":"C","c":"计算机网络"},{"a":"NAACL","n":"North American Chapter of the Associationfor Computational Linguistics","r":"B","c":"人工智能"},{"a":"NAS","n":"International Conference on Networking, Architecture and Storages","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"NCMMSC","n":"National Conference on Man-Machine Speech Communication","r":"C","c":"计算机图形学与多媒体"},{"a":"NDSS","n":"Network and Distributed System Security Symposium","r":"A","c":"网络与信息安全"},{"a":"Networking","n":"IFIP International Conferences on Networking","r":"C","c":"计算机网络"},{"a":"NeurIPS","n":"Conference on Neural Information Processing Systems","r":"A","c":"人工智能"},{"a":"NLPCC","n":"CCF International Conference on Natural Language Processing and Chinese Computing","r":"C","c":"人工智能"},{"a":"NOCS","n":"ACM/IEEE International Symposium on Networks-on-Chip","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"NOSSDAV","n":"International Workshop on Network and Operating System Support for Digital Audio and Video","r":"B","c":"计算机网络"},{"a":"NPC","n":"IFIP International Conference on Network and Parallel Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"NSDI","n":"Symposium on Network System Design and Implementation","r":"A","c":"计算机网络"},{"a":"NSPW","n":"New Security Paradigms Workshop","r":"C","c":"网络与信息安全"},{"a":"OOPSLA","n":"Conference on Object-Oriented Programming Systems, Languages,and Applications","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"OSDI","n":"USENIX Symposium on Operating Systems Design and Implementation","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"P2P","n":"IEEE International Conference on P2P Computing","r":"C","c":"计算机网络"},{"a":"PacificVis","n":"IEEE Pacific Visualization Symposium","r":"C","c":"计算机图形学与多媒体"},{"a":"PACT","n":"International Conference on Parallel Architectures and Compilation Techniques","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"PAKDD","n":"Pacific-Asia Conference on Knowledge Discovery and Data Mining","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"PAM","n":"Passive and Active Measurement Conference","r":"C","c":"网络与信息安全"},{"a":"PASTE","n":"ACMSIGPLAN-SIGSOFT Workshop on Program Analysis for Software Tools and Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"PEPM","n":"ACM SIGPLAN Workshop on Partial Evaluation and Program Manipulation","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"PERCOM","n":"IEEE International Conference on Pervasive Computing and Communications","r":"B","c":"人机交互与普适计算"},{"a":"Performance","n":"International Symposium on Computer Performance, Modeling, Measurements and Evaluation","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"PETS","n":"Privacy Enhancing Technologies Symposium","r":"C","c":"网络与信息安全"},{"a":"PG","n":"Pacific Conference on Computer Graphics and Applications","r":"B","c":"计算机图形学与多媒体"},{"a":"PKC","n":"International Workshop on Practice and Theory in Public Key Cryptography","r":"B","c":"网络与信息安全"},{"a":"PLDI","n":"ACM SIGPLAN Conference on Programming Language Design and Implementation","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"PODC","n":"ACM Symposium on Principles of Distributed Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"PODS","n":"ACM SIGMOD-SIGACT-SIGAI Symposium on Principles of Database Systems","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"POPL","n":"ACM SIGPLAN-SIGACT Symposium on Principles of Programming Languages","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"PPoPP","n":"ACM SIGPLAN Symposium on Principles & Practice of Parallel Programming","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"PPSN","n":"Parallel Problem Solving from Nature","r":"B","c":"人工智能"},{"a":"PRCV","n":"Chinese Conference on Pattern Recognition and Computer Vision","r":"C","c":"计算机图形学与多媒体"},{"a":"PRICAI","n":"Pacific Rim International Conference on Artificial Intelligence","r":"C","c":"人工智能"},{"a":"QRS","n":"International Conference on Software Quality, Reliability and Security","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"RAID","n":"International Symposium on Recent Advances in Intrusion Detection","r":"B","c":"网络与信息安全"},{"a":"RE","n":"IEEE International Requirements Engineering Conference","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"RECOMB","n":"Annual International Conference on Research inComputational Molecular Biology","r":"B","c":"交叉/综合/新兴"},{"a":"RecSys","n":"ACM Conference on Recommender Systems","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"REFSQ","n":"Requirements Engineering: Foundation for Software Quality","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"RTAS","n":"IEEE Real-Time and Embedded Technology and ApplicationsSymposium","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"RTSS","n":"IEEE Real-Time Systems Symposium","r":"A","c":"交叉/综合/新兴"},{"a":"RV","n":"International Conference on Runtime Verification","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"S&P","n":"IEEE Symposium on Security and Privacy","r":"A","c":"网络与信息安全"},{"a":"SAC","n":"Selected Areas in Cryptography","r":"C","c":"网络与信息安全"},{"a":"SACMAT","n":"ACM Symposium on Access Control Models and Technologies","r":"C","c":"网络与信息安全"},{"a":"SAGT","n":"International Symposium on Algorithmic Game Theory","r":"C","c":"交叉/综合/新兴"},{"a":"SANER","n":"IEEE International Conference on Software Analysis, Evolution,and Reengineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"SAS","n":"International Static Analysis Symposium","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"SAT","n":"International Conference on Theory and Applications of Satisfiability Testing","r":"B","c":"计算机科学理论"},{"a":"SC","n":"International Conference for High Performance Computing, Networking, Storage, and Analysis","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SCA","n":"ACM SIGGRAPH/Eurographics Symposium on Computer Animation","r":"B","c":"计算机图形学与多媒体"},{"a":"SCAM","n":"IEEE International Working Conference on Source Code Analysis and Manipulation","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"SDM","n":"SIAM International Conference on Data Mining","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"SEC","n":"ACM/IEEE Symposium on Edge Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SECON","n":"IEEE International Conference on Sensing, Communication, and Networking","r":"B","c":"计算机网络"},{"a":"SecureComm","n":"International Conference on Security and Privacy in Communication Networks","r":"C","c":"网络与信息安全"},{"a":"SEKE","n":"International Conference on Software Engineering and Knowledge Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"SenSys","n":"ACM Conference on Embedded Networked Sensor Systems","r":"B","c":"计算机网络"},{"a":"SETTA","n":"International Symposium on Software Engineering: Theories, Tools, and Applications","r":"C","c":"计算机科学理论"},{"a":"SGP","n":"Eurographics Symposium on Geometry Processing","r":"B","c":"计算机图形学与多媒体"},{"a":"SIGCOMM","n":"ACM International Conference on Applications, Technologies, Architectures, and Protocols for Computer Communication","r":"A","c":"计算机网络"},{"a":"SIGGRAPH","n":"ACM Special Interest Group on Computer Graphics","r":"A","c":"计算机图形学与多媒体"},{"a":"SIGIR","n":"International ACM SIGIR Conference on Research and Development in Information Retrieval","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"SIGKDD","n":"ACM SIGKDD Conference on Knowledge Discovery and Data Mining","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"SIGMETRICS","n":"International Conference on Measurement and Modeling of Computer Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SIGMOD","n":"ACM SIGMOD Conference","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"SIGSPATIAL","n":"ACM Special Interest Group on Spatial Information","r":"C","c":"交叉/综合/新兴"},{"a":"SLT","n":"Spoken Language Technology","r":"C","c":"计算机图形学与多媒体"},{"a":"SMC","n":"IEEE International Conference on Systems, Man, and Cybernetics","r":"C","c":"交叉/综合/新兴"},{"a":"SMI","n":"Shape Modeling International","r":"C","c":"计算机图形学与多媒体"},{"a":"SoCC","n":"ACM Symposium on Cloud Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SoCG","n":"International Symposium on Computational Geometry","r":"B","c":"计算机科学理论"},{"a":"SODA","n":"ACM-SIAM Symposium on Discrete Algorithms","r":"A","c":"计算机科学理论"},{"a":"SOSP","n":"ACM Symposium on Operating Systems Principles","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"SOUPS","n":"Symposium On Usable Privacy and Security","r":"C","c":"网络与信息安全"},{"a":"SPAA","n":"ACM Symposium on Parallelism in Algorithms and Architectures","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SPIN","n":"International Symposium on Model Checking of Software","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"SPM","n":"Symposium on Solid and Physical Modeling","r":"B","c":"计算机图形学与多媒体"},{"a":"SRDS","n":"IEEE International Symposium on Reliable Distributed Systems","r":"B","c":"网络与信息安全"},{"a":"SSDBM","n":"International Conference on Scientific andStatistical Database Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"SSE","n":"IEEE International Conference on Software Services Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"SSTD","n":"International Symposium on Spatial and Temporal Databases","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"STACS","n":"Symposium on Theoretical Aspects of Computer Science","r":"C","c":"计算机科学理论"},{"a":"STOC","n":"ACM Symposium on the Theory of Computing","r":"A","c":"计算机科学理论"},{"a":"SYSTOR","n":"ACM International Systems and Storage Conference","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TASE","n":"Theoretical Aspects of Software Engineering Conference","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"TCC","n":"Theory of Cryptography Conference","r":"B","c":"网络与信息安全"},{"a":"TrustCom","n":"IEEE International Conference on Trust,Security and Privacy in Computing and Communications","r":"C","c":"网络与信息安全"},{"a":"UAI","n":"Conference on Uncertainty in ArtificialIntelligence","r":"B","c":"人工智能"},{"a":"UbiComp","n":"ACM International Joint Conference on Pervasive and Ubiquitous Computing","r":"A","c":"人机交互与普适计算"},{"a":"UIC","n":"IEEE International Conference on Ubiquitous Intelligence and Computing","r":"C","c":"人机交互与普适计算"},{"a":"UIST","n":"ACM Symposium on User Interface Software and Technology","r":"A","c":"人机交互与普适计算"},{"a":"USENIX Security","n":"USENIX Security Symposium","r":"A","c":"网络与信息安全"},{"a":"VEE","n":"International Conference on Virtual Execution Environments","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"VLDB","n":"International Conference on Very Large Data Bases","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"VMCAI","n":"International Conference on Verification,Model Checking, and Abstract Interpretation","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"VR","n":"IEEE Conference on Virtual Reality and 3D User Interfaces","r":"A","c":"计算机图形学与多媒体"},{"a":"VRST","n":"ACM Symposium on Virtual Reality Software and Technology","r":"C","c":"计算机图形学与多媒体"},{"a":"VTS","n":"IEEE VLSI Test Symposium","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"WAIM","n":"International Conference on Web Age Information Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"WASA","n":"The International Conference on Wireless Artificial Intelligent Computing Systems and Applications","r":"C","c":"计算机网络"},{"a":"WCNC","n":"IEEE Wireless Communications and Networking Conference","r":"C","c":"计算机网络"},{"a":"WebDB","n":"International Workshop on Web andDatabases","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"WICSA","n":"Working IEEE/IFIP Conference on Software Architecture","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"WINE","n":"Conference on Web and Internet Economics","r":"B","c":"交叉/综合/新兴"},{"a":"WISA","n":"Web Information Systems and Applications","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"WISE","n":"Web Information Systems Engineering Conference","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"WiSec","n":"ACM Conference on Security and Privacy in Wireless and Mobile Networks","r":"C","c":"网络与信息安全"},{"a":"WoWMoM","n":"IEEE International Symposium on a World of Wireless Mobile and Multimedia Networks","r":"C","c":"计算机网络"},{"a":"WSDM","n":"ACM International Conference on Web Search and Data Mining","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"WWW","n":"The Web Conference","r":"A","c":"交叉/综合/新兴"}];

  // CCF 推荐国际学术期刊(第七版,290 种,含无缩写条目 a="")
  const CCF_JOURNALS = [{"a":"AAMAS","n":"Autonomous Agents and Multi-Agent Systems","r":"B","c":"人工智能"},{"a":"ACM DLT","n":"ACM Distributed Ledger Technologies: Research and Practice","r":"C","c":"交叉/综合/新兴"},{"a":"ACTA","n":"Acta Informatica","r":"C","c":"计算机科学理论"},{"a":"","n":"Ad hoc Networks","r":"C","c":"计算机网络"},{"a":"AEI","n":"Advanced Engineering Informatics","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"AI","n":"Artificial Intelligence","r":"A","c":"人工智能"},{"a":"AIM","n":"Artificial Intelligence in Medicine","r":"C","c":"人工智能"},{"a":"Algorithmica","n":"Algorithmica","r":"B","c":"计算机科学理论"},{"a":"APAL","n":"Annals of Pure and Applied Logic","r":"C","c":"计算机科学理论"},{"a":"","n":"Applied Intelligence","r":"C","c":"人工智能"},{"a":"","n":"Artificial Life","r":"C","c":"人工智能"},{"a":"ASE","n":"Automated Software Engineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"BCRA","n":"Blockchain: Research and Applications","r":"B","c":"交叉/综合/新兴"},{"a":"Bioinformatics","n":"Bioinformatics","r":"A","c":"交叉/综合/新兴"},{"a":"BIT","n":"Behaviour & Information Technology","r":"C","c":"人机交互与普适计算"},{"a":"","n":"BMC Bioinformatics","r":"C","c":"交叉/综合/新兴"},{"a":"","n":"Briefings in Bioinformatics","r":"B","c":"交叉/综合/新兴"},{"a":"C&G","n":"Computers & Graphics","r":"C","c":"计算机图形学与多媒体"},{"a":"CAD","n":"Computer-Aided Design","r":"B","c":"计算机图形学与多媒体"},{"a":"CAGD","n":"Computer Aided Geometric Design","r":"B","c":"计算机图形学与多媒体"},{"a":"CAVW","n":"computer animation & virtual worlds","r":"C","c":"计算机图形学与多媒体"},{"a":"CC","n":"Computer Communications","r":"C","c":"计算机网络"},{"a":"CCF TPCI","n":"CCF Transactions on Pervasive Computing and Interaction","r":"B","c":"人机交互与普适计算"},{"a":"CCF-THPC","n":"CCF Transactions on High Performance Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"CGF","n":"Computer Graphics Forum","r":"B","c":"计算机图形学与多媒体"},{"a":"CGTA","n":"Computational Geometry: Theory and Applications","r":"C","c":"计算机图形学与多媒体"},{"a":"CL","n":"Computer Languages, Systems and Structures","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"CLSR","n":"Computer Law & Security Review","r":"C","c":"网络与信息安全"},{"a":"CN","n":"Computer Networks","r":"B","c":"计算机网络"},{"a":"Cognition","n":"Cognition","r":"B","c":"交叉/综合/新兴"},{"a":"","n":"Computational Intelligence","r":"C","c":"人工智能"},{"a":"","n":"Computational Linguistics","r":"B","c":"人工智能"},{"a":"","n":"Computer Speech & Language","r":"C","c":"人工智能"},{"a":"","n":"Computers & Security","r":"B","c":"网络与信息安全"},{"a":"","n":"Concurrency and Computation: Practice and Experience","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"","n":"Connection Science","r":"C","c":"人工智能"},{"a":"CSCW","n":"Computer Supported Cooperative Work","r":"B","c":"人机交互与普适计算"},{"a":"CVIU","n":"Computer Vision and Image Understanding","r":"B","c":"人工智能"},{"a":"CVMJ","n":"Computational Visual Media","r":"B","c":"计算机图形学与多媒体"},{"a":"","n":"Cybernetics and Systems","r":"C","c":"交叉/综合/新兴"},{"a":"Cybersecurity","n":"Cybersecurity","r":"B","c":"网络与信息安全"},{"a":"DAM","n":"Discrete Applied Mathematics","r":"C","c":"计算机科学理论"},{"a":"DC","n":"Distributed Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"DCG","n":"Discrete & Computational Geometry","r":"C","c":"计算机图形学与多媒体"},{"a":"","n":"Designs, Codes and Cryptography","r":"B","c":"网络与信息安全"},{"a":"","n":"Discover Computing","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"DKE","n":"Data & Knowledge Engineering","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"DMKD","n":"Data Mining and Knowledge Discovery","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"DPD","n":"Distributed and Parallel Databases","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"DSE","n":"Data Science and Engineering","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"DSS","n":"Decision Support Systems","r":"C","c":"人工智能"},{"a":"EAAI","n":"Engineering Applications of Artificial Intelligence","r":"C","c":"人工智能"},{"a":"EITEE","n":"ENGINEERING Information Technology & Electronic Engineering","r":"C","c":"交叉/综合/新兴"},{"a":"EJIS","n":"European Journal of Information Systems","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"ESE","n":"Empirical Software Engineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"ESWA","n":"Expert Systems with Applications","r":"C","c":"人工智能"},{"a":"","n":"EURASIP Journal on Information Security","r":"C","c":"网络与信息安全"},{"a":"","n":"Evolutionary Computation","r":"B","c":"人工智能"},{"a":"","n":"Expert Systems","r":"C","c":"人工智能"},{"a":"FAC","n":"Formal Aspects of Computing","r":"B","c":"计算机科学理论"},{"a":"FCS","n":"Frontiers of Computer Science","r":"B","c":"交叉/综合/新兴"},{"a":"FGCS","n":"Future Generation Computer Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"FMSD","n":"Formal Methods in System Design","r":"B","c":"计算机科学理论"},{"a":"FUIN","n":"Fundamenta Informaticae","r":"C","c":"计算机科学理论"},{"a":"","n":"Fuzzy Sets and Systems","r":"C","c":"人工智能"},{"a":"","n":"GeoInformatica","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"GMOD","n":"Graphical Models","r":"C","c":"计算机图形学与多媒体"},{"a":"HCC","n":"High-Confidence Computing","r":"C","c":"网络与信息安全"},{"a":"HCI","n":"Human-Computer Interaction","r":"B","c":"人机交互与普适计算"},{"a":"HEALTH","n":"ACM Transactions on Computing for Healthcare","r":"C","c":"交叉/综合/新兴"},{"a":"I&M","n":"Information & Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IANDC","n":"Information and Computation","r":"A","c":"计算机科学理论"},{"a":"IDA","n":"Intelligent Data Analysis","r":"C","c":"人工智能"},{"a":"","n":"IEEE Geoscience and Remote Sensing Letters","r":"C","c":"交叉/综合/新兴"},{"a":"","n":"IEEE Transactions on Cybernetics","r":"B","c":"人工智能"},{"a":"","n":"IEEE Transactions on Human-Machine Systems","r":"B","c":"人机交互与普适计算"},{"a":"","n":"IEEE Transactions on Reliability","r":"C","c":"交叉/综合/新兴"},{"a":"","n":"IET Communications","r":"C","c":"计算机网络"},{"a":"","n":"IET Information Security","r":"C","c":"网络与信息安全"},{"a":"","n":"IET Intelligent Transport Systems","r":"C","c":"交叉/综合/新兴"},{"a":"","n":"IET Signal Processing","r":"C","c":"人工智能"},{"a":"IET-CVI","n":"IET Computer Vision","r":"C","c":"人工智能"},{"a":"IET-IPR","n":"IET Image Processing","r":"C","c":"计算机图形学与多媒体"},{"a":"IETS","n":"IET Software","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"IJAR","n":"International Journal of Approximate Reasoning","r":"B","c":"人工智能"},{"a":"IJCIA","n":"International Journal of Computational Intelligence and Applications","r":"C","c":"人工智能"},{"a":"IJCIS","n":"International Journal of Cooperative Information Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IJCV","n":"International Journal of Computer Vision","r":"A","c":"人工智能"},{"a":"IJDAR","n":"International Journal on Document Analysis and Recognition","r":"C","c":"人工智能"},{"a":"IJGIS","n":"International Journal of Geographical Information Science","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IJHCI","n":"International Journal of Human-Computer Interaction","r":"B","c":"人机交互与普适计算"},{"a":"IJHCS","n":"International Journal of Human-Computer Studies","r":"A","c":"人机交互与普适计算"},{"a":"IJICS","n":"International Journal of Information and Computer Security","r":"C","c":"网络与信息安全"},{"a":"IJIS","n":"International Journal of Intelligent Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IJISP","n":"International Journal of Information Security and Privacy","r":"C","c":"网络与信息安全"},{"a":"IJKM","n":"International Journal of Knowledge Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IJNS","n":"International Journal of Neural Systems","r":"C","c":"人工智能"},{"a":"IJPRAI","n":"International Journal of Pattern Recognition and Artificial Intelligence","r":"C","c":"人工智能"},{"a":"IJSEKE","n":"International Journal of Software Engineering and Knowledge Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"IJSWIS","n":"International Journal on Semantic Web and Information Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IJUFKS","n":"International Journal of Uncertainty,Fuzziness and Knowledge-Based Systems","r":"C","c":"人工智能"},{"a":"IMAGE","n":"Signal Processing: Image Communication","r":"C","c":"计算机图形学与多媒体"},{"a":"IMCS","n":"Information and Computer Security","r":"C","c":"网络与信息安全"},{"a":"","n":"Information Sciences","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"INFORMS","n":"INFORMS Journal on Computing","r":"B","c":"计算机科学理论"},{"a":"Integration","n":"Integration, the VLSI Journal","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"IOT","n":"IEEE Internet of Things Journal","r":"C","c":"计算机网络"},{"a":"IPL","n":"Information Processing Letters","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"IPM","n":"Information Processing and Management","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"IS","n":"Information Systems","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"IST","n":"Information and Software Technology","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"IVC","n":"Image and Vision Computing","r":"C","c":"人工智能"},{"a":"IWC","n":"Interacting with Computers","r":"B","c":"人机交互与普适计算"},{"a":"JACM","n":"Journal of the ACM","r":"A","c":"交叉/综合/新兴"},{"a":"JAIR","n":"Journal of Artificial Intelligence Research","r":"B","c":"人工智能"},{"a":"JAMIA","n":"Journal of the American Medical Informatics Association","r":"B","c":"交叉/综合/新兴"},{"a":"JASA","n":"The Journal of the Acoustical Society of America","r":"B","c":"计算机图形学与多媒体"},{"a":"JASIST","n":"Journal of the Association for Information Science and Technology","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"JATS","n":"ACM Journal on Autonomous Transportation Systems","r":"C","c":"人工智能"},{"a":"JBHI","n":"IEEE Journal of Biomedical and Health Informatics","r":"C","c":"交叉/综合/新兴"},{"a":"JBI","n":"Journal of Biomedical Informatics","r":"C","c":"交叉/综合/新兴"},{"a":"JCIS","n":"Journal of Computer Information Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"JCOMPLEXITY","n":"Journal of Complexity","r":"C","c":"计算机科学理论"},{"a":"JCS","n":"Journal of Computer Security","r":"B","c":"网络与信息安全"},{"a":"JCSS","n":"Journal of Computer and System Sciences","r":"B","c":"计算机科学理论"},{"a":"JCST","n":"Journal of Computer Science and Technology","r":"B","c":"交叉/综合/新兴"},{"a":"JDM","n":"Journal of Database Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"JETAI","n":"Journal of Experimental and Theoretical Artificial Intelligence","r":"C","c":"人工智能"},{"a":"JETC","n":"ACM Journal on Emerging Technologies in Computing Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"JETTA","n":"Journal of Electronic Testing-Theory and Applications","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"JFP","n":"Journal of Functional Programming","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"JGC","n":"The Journal of Grid computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"JGITM","n":"Journal of Global Information Technology Management","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"JGO","n":"Journal of Global Optimization","r":"B","c":"计算机科学理论"},{"a":"JIIS","n":"Journal of Intelligent Information Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"JISA","n":"Journal of Information Security and Applications","r":"C","c":"网络与信息安全"},{"a":"JLAMP","n":"Journal of Logical and Algebraic Methods in Programming","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"JMLR","n":"Journal of Machine Learning Research","r":"A","c":"人工智能"},{"a":"JNCA","n":"Journal of Network and Computer Applications","r":"C","c":"计算机网络"},{"a":"","n":"Journal of Automated Reasoning","r":"B","c":"人工智能"},{"a":"","n":"Journal of Cryptology","r":"A","c":"网络与信息安全"},{"a":"","n":"Journal of Software: Evolution and Process","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"JPDC","n":"Journal of Parallel and Distributed Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"JSA","n":"Journal of Systems Architecture: Embedded Software Design","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"JSAC","n":"IEEE Journal on Selected Areas in Communications","r":"A","c":"计算机网络"},{"a":"JSC","n":"Journal of Symbolic Computation","r":"B","c":"计算机科学理论"},{"a":"JSIS","n":"The Journal of Strategic Information Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"JSL","n":"The Journal of Symbolic Logic","r":"C","c":"计算机科学理论"},{"a":"JSLHR","n":"Journal of Speech, Language, and Hearing Research","r":"B","c":"人工智能"},{"a":"JSS","n":"Journal of Systems and Software","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"JVCIR","n":"Journal of Visual Communication and Image Representation","r":"C","c":"计算机图形学与多媒体"},{"a":"JWE","n":"Journal of Web Engineering","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"JWS","n":"Journal of Web Semantics","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"KAIS","n":"Knowledge and Information Systems","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"KBS","n":"Knowledge-Based Systems","r":"C","c":"人工智能"},{"a":"LMCS","n":"Logical Methods in Computer Science","r":"C","c":"计算机科学理论"},{"a":"LOGCOM","n":"Journal of Logic and Computation","r":"C","c":"计算机科学理论"},{"a":"","n":"Machine Learning","r":"B","c":"人工智能"},{"a":"","n":"Machine Translation","r":"C","c":"人工智能"},{"a":"","n":"Machine Vision and Applications","r":"C","c":"人工智能"},{"a":"","n":"Medical Image Analysis","r":"C","c":"交叉/综合/新兴"},{"a":"MONET","n":"Mobile Networks and Applications","r":"C","c":"计算机网络"},{"a":"MS","n":"Multimedia Systems","r":"C","c":"计算机图形学与多媒体"},{"a":"MSCS","n":"Mathematical Structures in Computer Science","r":"B","c":"计算机科学理论"},{"a":"MTA","n":"Multimedia Tools and Applications","r":"C","c":"计算机图形学与多媒体"},{"a":"","n":"Natural Computing","r":"C","c":"人工智能"},{"a":"NCA","n":"Neural Computing and Applications","r":"C","c":"人工智能"},{"a":"","n":"Networks","r":"C","c":"计算机网络"},{"a":"","n":"Neural Computation","r":"B","c":"人工智能"},{"a":"","n":"Neural Networks","r":"B","c":"人工智能"},{"a":"","n":"Neurocomputing","r":"C","c":"人工智能"},{"a":"NLE","n":"Natural Language Engineering","r":"C","c":"人工智能"},{"a":"NPL","n":"Neural Processing Letters","r":"C","c":"人工智能"},{"a":"PAA","n":"Pattern Analysis and Applications","r":"C","c":"人工智能"},{"a":"PACM PL","n":"Proceedings of the ACM on Programming Languages","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"PACMHCI","n":"Proceedings of the ACM on Human-Computer Interaction","r":"C","c":"人机交互与普适计算"},{"a":"","n":"Parallel Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"","n":"Performance Evaluation: An International Journal","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"","n":"PLOS Computational Biology","r":"B","c":"交叉/综合/新兴"},{"a":"PMC","n":"Pervasive and Mobile Computing","r":"C","c":"人机交互与普适计算"},{"a":"PPNA","n":"Peer-to-Peer Networking and Applications","r":"C","c":"计算机网络"},{"a":"PR","n":"Pattern Recognition","r":"B","c":"人工智能"},{"a":"PRL","n":"Pattern Recognition Letters","r":"C","c":"人工智能"},{"a":"Proc. IEEE","n":"Proceedings of the IEEE","r":"A","c":"交叉/综合/新兴"},{"a":"PUC","n":"Personal and Ubiquitous Computing","r":"C","c":"人机交互与普适计算"},{"a":"RE","n":"Requirements Engineering","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"RTS","n":"Real-Time Systems","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"SCIS","n":"Science China Information Sciences","r":"A","c":"交叉/综合/新兴"},{"a":"SCN","n":"Security and Communication Networks","r":"C","c":"网络与信息安全"},{"a":"SCP","n":"Science of Computer Programming","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"SICOMP","n":"SIAM Journal on Computing","r":"A","c":"计算机科学理论"},{"a":"SIDMA","n":"SIAM Journal on Discrete Mathematics","r":"C","c":"计算机科学理论"},{"a":"SIGPRO","n":"Signal Processing","r":"C","c":"计算机图形学与多媒体"},{"a":"SIIMS","n":"SIAM Journal on Imaging Sciences","r":"B","c":"计算机图形学与多媒体"},{"a":"SOCA","n":"Service Oriented Computing and Applications","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"","n":"Soft Computing","r":"C","c":"人工智能"},{"a":"SoSyM","n":"Software and Systems Modeling","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"SPE","n":"Software: Practice and Experience","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"SPECOM","n":"Speech Communication","r":"B","c":"计算机图形学与多媒体"},{"a":"SPL","n":"IEEE Signal Processing Letters","r":"C","c":"计算机图形学与多媒体"},{"a":"SQJ","n":"Software Quality Journal","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"STTT","n":"International Journal of Software Tools for Technology Transfer","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"STVR","n":"Software Testing, Verification and Reliability","r":"B","c":"软件工程/系统软件/程序设计语言"},{"a":"TAAS","n":"ACM Transactions on Autonomous and Adaptive Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TAC","n":"IEEE Transactions on Affective Computing","r":"B","c":"人工智能"},{"a":"TACL","n":"Transactions of the Association for Computational Linguistics","r":"B","c":"人工智能"},{"a":"TACO","n":"ACM Transactions on Architecture and Code Optimization","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TALG","n":"ACM Transactions on Algorithms","r":"B","c":"计算机科学理论"},{"a":"TALLIP","n":"ACM Transactions on Asian and Low-Resource Language Information Processing","r":"C","c":"人工智能"},{"a":"TAP","n":"ACM Transactions on Applied Perception","r":"B","c":"人工智能"},{"a":"TASAE","n":"IEEE Transactions on Automation Science and Engineering","r":"B","c":"交叉/综合/新兴"},{"a":"TASLP","n":"IEEE Transactions on Audio, Speech and Language Processing","r":"B","c":"人工智能"},{"a":"TBD","n":"IEEE Transactions on Big Data","r":"C","c":"交叉/综合/新兴"},{"a":"TC","n":"IEEE Transactions on Computers","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TCAD","n":"IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TCASI","n":"IEEE Transactions on Circuits and Systems I: Regular Papers","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TCBB","n":"IEEE/ACM Transactions on Computational Biology and Bioinformatics","r":"B","c":"交叉/综合/新兴"},{"a":"TCC","n":"IEEE Transactions on Cloud Computing","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TCOM","n":"IEEE Transactions on Communications","r":"B","c":"计算机网络"},{"a":"TCPS","n":"ACM Transactions on Cyber-Physical Systems","r":"C","c":"交叉/综合/新兴"},{"a":"TCS","n":"Theoretical Computer Science","r":"B","c":"计算机科学理论"},{"a":"TCSS","n":"IEEE Transactions on Computational Social Systems","r":"C","c":"交叉/综合/新兴"},{"a":"TCSVT","n":"IEEE Transactions on Circuits and Systems for Video Technology","r":"B","c":"计算机图形学与多媒体"},{"a":"TDSC","n":"IEEE Transactions on Dependable and Secure Computing","r":"A","c":"网络与信息安全"},{"a":"TEC","n":"IEEE Transactions on Evolutionary Computation","r":"B","c":"人工智能"},{"a":"TECS","n":"ACM Transactions on Embedded Computing Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TELO","n":"ACM Transactions on Evolutionary Learning and Optimization","r":"C","c":"人工智能"},{"a":"TFS","n":"IEEE Transactions on Fuzzy Systems","r":"B","c":"人工智能"},{"a":"TG","n":"IEEE Transactions on Games","r":"C","c":"人工智能"},{"a":"TGARS","n":"IEEE Transactions on Geoscience and Remote Sensing","r":"B","c":"交叉/综合/新兴"},{"a":"","n":"The Computer Journal","r":"B","c":"交叉/综合/新兴"},{"a":"","n":"Theory of Computing Systems","r":"C","c":"计算机科学理论"},{"a":"THRI","n":"ACM Transactions on Human-Robot Interaction","r":"C","c":"人机交互与普适计算"},{"a":"TIFS","n":"IEEE Transactions on Information Forensics and Security","r":"A","c":"网络与信息安全"},{"a":"TII","n":"IEEE Transactions on Industrial Informatics","r":"C","c":"交叉/综合/新兴"},{"a":"TIIS","n":"ACM Transactions on Interactive Intelligent Systems","r":"C","c":"人工智能"},{"a":"TIOT","n":"ACM Transactions on Internet of Things","r":"C","c":"计算机网络"},{"a":"TIP","n":"IEEE Transactions on Image Processing","r":"A","c":"计算机图形学与多媒体"},{"a":"TIST","n":"ACM Transactions on Intelligent Systems and Technology","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"TIT","n":"IEEE Transactions on Information Theory","r":"A","c":"计算机科学理论"},{"a":"TITS","n":"IEEE Transactions on Intelligent Transportation Systems","r":"B","c":"交叉/综合/新兴"},{"a":"TJSC","n":"The Journal of Supercomputing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TKDD","n":"ACM Transactions on Knowledge Discovery from Data","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"TKDE","n":"IEEE Transactions on Knowledge and Data Engineering","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"TMC","n":"IEEE Transactions on Mobile Computing","r":"A","c":"计算机网络"},{"a":"TMI","n":"IEEE Transactions on Medical Imaging","r":"B","c":"交叉/综合/新兴"},{"a":"TMM","n":"IEEE Transactions on Multimedia","r":"A","c":"计算机图形学与多媒体"},{"a":"TNNLS","n":"IEEE Transactions on Neural Networks and learning systems","r":"B","c":"人工智能"},{"a":"TNSM","n":"IEEE Transactions on Network and Service Management","r":"C","c":"计算机网络"},{"a":"TOCE","n":"ACM Transactions on Computing Education","r":"C","c":"交叉/综合/新兴"},{"a":"TOCHI","n":"ACM Transactions on Computer-Human Interaction","r":"A","c":"人机交互与普适计算"},{"a":"TOCL","n":"ACM Transactions on Computational Logic","r":"B","c":"计算机科学理论"},{"a":"TOCS","n":"ACM Transactions on Computer Systems","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TODAES","n":"ACM Transactions on Design Automation of Electronic Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TODS","n":"ACM Transactions on Database Systems","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"TOG","n":"ACM Transactions on Graphics","r":"A","c":"计算机图形学与多媒体"},{"a":"TOIS","n":"ACM Transactions on Information Systems","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"TOIT","n":"ACM Transactions on Internet Technology","r":"B","c":"计算机网络"},{"a":"TOMM","n":"ACM Transactions on Multimedia Computing, Communications and Applications","r":"B","c":"计算机网络"},{"a":"TOMS","n":"ACM Transactions on Mathematical Software","r":"B","c":"计算机科学理论"},{"a":"TON","n":"IEEE Transactions on Networking","r":"A","c":"计算机网络"},{"a":"TOPLAS","n":"ACM Transactions on Programming Languages and Systems","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"TOPS","n":"ACM Transactions on Privacy and Security","r":"B","c":"网络与信息安全"},{"a":"TORS","n":"ACM Transactions on Recommender Systems","r":"C","c":"数据库/数据挖掘/内容检索"},{"a":"TOS","n":"ACM Transactions on Storage","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TOSEM","n":"ACM Transactions on Software Engineering and Methodology","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"TOSN","n":"ACM Transactions on Sensor Networks","r":"B","c":"计算机网络"},{"a":"TPAMI","n":"IEEE Transactions on Pattern Analysis and Machine Intelligence","r":"A","c":"人工智能"},{"a":"TPDS","n":"IEEE Transactions on Parallel and Distributed Systems","r":"A","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TPLP","n":"Theory and Practice of Logic Programming","r":"C","c":"软件工程/系统软件/程序设计语言"},{"a":"TQC","n":"ACM Transactions in Quantum Computing","r":"C","c":"计算机科学理论"},{"a":"TR","n":"IEEE Transactions on Robotics","r":"B","c":"交叉/综合/新兴"},{"a":"TRETS","n":"ACM Transactions on Reconfigurable Technology and Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TSC","n":"IEEE Transactions on Services Computing","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"TSE","n":"IEEE Transactions on Software Engineering","r":"A","c":"软件工程/系统软件/程序设计语言"},{"a":"TSMC","n":"IEEE Transactions on Systems, Man, and Cybernetics: Systems","r":"B","c":"人机交互与普适计算"},{"a":"TSUSC","n":"IEEE Transactions on Sustainable Computing","r":"C","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TVC","n":"The Visual Computer","r":"C","c":"计算机图形学与多媒体"},{"a":"TVCG","n":"IEEE Transactions on Visualization and Computer Graphics","r":"A","c":"计算机图形学与多媒体"},{"a":"TVLSI","n":"IEEE Transactions on Very Large Scale Integration (VLSI) Systems","r":"B","c":"计算机体系结构/并行与分布计算/存储系统"},{"a":"TWC","n":"IEEE Transactions on Wireless Communications","r":"B","c":"计算机网络"},{"a":"TWEB","n":"ACM Transactions on the Web","r":"B","c":"数据库/数据挖掘/内容检索"},{"a":"UMUAI","n":"User Modeling and User-Adapted Interaction","r":"B","c":"人机交互与普适计算"},{"a":"VI","n":"Visual Informatics","r":"C","c":"计算机图形学与多媒体"},{"a":"VLDBJ","n":"The VLDB Journal","r":"A","c":"数据库/数据挖掘/内容检索"},{"a":"VRIH","n":"Virtual Reality & Intelligent Hardware","r":"C","c":"计算机图形学与多媒体"},{"a":"WCMC","n":"Wireless Communications and Mobile Computing","r":"C","c":"计算机网络"},{"a":"WI","n":"Web Intelligence","r":"C","c":"人工智能"},{"a":"","n":"Wireless Networks","r":"C","c":"计算机网络"},{"a":"WWW","n":"The Web Conference","r":"B","c":"交叉/综合/新兴"}];

  const CCF_ALIAS = { nips: 'neurips' };
  const RANK_ORDER = { A: 1, B: 2, C: 3 };

  function normalizeName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/['".,:;()\[\]{}\-_/\\|!?*«»《》·,+]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripYearTail(s) {
    return String(s || '').replace(/[,\s]*(19|20)\d{2}[a-z]?\s*$/, '').trim();
  }

  function stripProceedings(s) {
    return String(s || '')
      .replace(/^(in\s+)?proceedings(\s+of(\s+the)?)?\s*/, '')
      .replace(/^proc\s+/, '')
      .replace(/^the\s+/, '')
      .trim();
  }

  // 解析 LetPub 期刊搜索结果页(doc 为 DOMParser 产物),返回条目数组。
  // 数据行特征: 表格行内含 view=detail 且非 xuanxiangk 的 journalid 链接,行内 >= 8 个 td。
  function parseLetPubSearchDocument(doc) {
    const out = [];
    const seen = new Set();
    if (!doc || !doc.querySelectorAll) return out;
    const links = doc.querySelectorAll('a[href*="journalid="]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href.indexOf('view=detail') === -1) continue;
      if (href.indexOf('xuanxiangk') !== -1) continue;
      const tr = a.closest ? a.closest('tr') : null;
      if (!tr || tr.hasAttribute('data-lpfq')) continue;
      const tds = tr.querySelectorAll('td');
      if (tds.length < 8) continue;
      tr.setAttribute('data-lpfq', '1');
      const idm = href.match(/journalid=(\d+)/);
      const id = idm ? idm[1] : href;
      if (seen.has(id)) continue;
      seen.add(id);

      const texts = [];
      for (const td of tds) texts.push((td.textContent || '').replace(/\s+/g, ' ').trim());

      let zone = null, big = '', sub = '', iff = '';
      let sci = '', oa = '', accept = '', review = '';
      for (const t of texts) {
        if (zone === null) {
          const m = t.match(/(?:^|\s)([1-4]区)(?=\s|$)/);
          if (m) zone = m[1];
        }
        if (!big) {
          const m = t.match(/大类[:：]\s*(.+?)(?:\s*小类[:：]|$)/);
          if (m) {
            big = m[1].trim();
            const m2 = t.match(/小类[:：]\s*(.+)$/);
            if (m2) sub = m2[1].trim();
          }
        }
        if (!iff) {
          const m = t.match(/(?:^|\s)IF\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
          if (m) iff = m[1];
        }
        if (!sci && /^(SCI|SCIE|SSCI|ESCI|AHCI)(?:\s*(?:SCIE|SSCI|ESCI|AHCI))*\s*$/i.test(t)) sci = t.replace(/\s+/g, ' ').trim();
        if (!oa && /^(Yes|No)$/i.test(t)) oa = /yes/i.test(t) ? 'OA' : '非OA';
        if (!review && /周|个月|平均|较慢|较快|偏慢|很快|极快/.test(t) && !/IF|h-index|CiteScore|区/i.test(t)) review = t;
        if (!accept && /约稿|%|较易|较难|很易|很难|容易/.test(t) && !/周|个月/.test(t)) accept = t;
      }

      let abbr = '';
      const cell = a.closest ? a.closest('td') : null;
      if (cell) {
        const f = cell.querySelector('font');
        if (f) abbr = (f.textContent || '').replace(/\s+/g, ' ').trim();
      }

      out.push({
        id: id,
        name: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        abbr: abbr,
        url: 'https://www.letpub.com.cn/' + href.replace(/^\.\//, '').replace(/^\//, ''),
        zone: zone,
        big: big,
        sub: sub,
        iff: iff,
        sci: sci,
        oa: oa,
        accept: accept,
        review: review
      });
    }
    return out;
  }

  // 从搜索结果里挑出与查询词最匹配的条目
  function pickBestLetPub(entries, query) {
    if (!entries || !entries.length) return null;
    const q = normalizeName(query);
    if (!q) return entries[0];
    let hit = entries.find(e => normalizeName(e.name) === q || normalizeName(e.abbr) === q);
    if (hit) return hit;
    hit = entries.find(e => normalizeName(e.name).indexOf(q) !== -1);
    if (hit) return hit;
    hit = entries.find(e => q.indexOf(normalizeName(e.name)) !== -1 || q.indexOf(normalizeName(e.abbr)) !== -1);
    if (hit) return hit;
    return entries.length === 1 ? entries[0] : null;
  }

  // CCF 会议匹配: 精确(全称/缩写/去掉 proceedings 前缀与年份) → 单词缩写词匹配 → 词级子集(仅会议措辞)
  let CCF_INDEX = null;
  function ccfGetIndex() {
    if (!CCF_INDEX) {
      const byAbbr = new Map(), byFull = new Map();
      for (const c of CCF_CONFS) {
        byAbbr.set(normalizeName(c.a), c);
        if (c.n) byFull.set(normalizeName(c.n), c);
      }
      CCF_INDEX = { byAbbr: byAbbr, byFull: byFull };
    }
    return CCF_INDEX;
  }

  function ccfMatch(name) {
    const idx = ccfGetIndex();
    let s = stripYearTail(normalizeName(name));
    if (!s) return null;

    const keys = [s];
    const s2 = stripProceedings(s);
    if (s2 && keys.indexOf(s2) === -1) keys.push(s2);
    const s3 = s2.replace(/^\d{4}\s+/, '').replace(/^\d+(st|nd|rd|th)\s+/, '').trim();
    if (s3 && keys.indexOf(s3) === -1) keys.push(s3);
    for (const k of keys) {
      const kk = CCF_ALIAS[k] || k;
      const c = idx.byAbbr.get(kk) || idx.byFull.get(kk);
      if (c) return c;
    }

    // 单个词(如 SIGGRAPH)与目录缩写的词精确相等
    if (s.indexOf(' ') === -1 && s.length >= 4) {
      for (const c of CCF_CONFS) {
        if (normalizeName(c.a).split(' ').indexOf(s) !== -1) return c;
      }
    }

    // 词级子集: 查询词的所有实词都出现在某会议全称/缩写中
    const base = s3 || s2 || s;
    const STOP = { the: 1, of: 1, on: 1, in: 1, for: 1, and: 1, a: 1, an: 1, proceedings: 1, proc: 1,
      annual: 1, meeting: 1, conference: 1, conferences: 1, symposium: 1, workshop: 1, congress: 1, international: 1 };
    const qtok = base.split(' ').filter(t => t && !STOP[t] && t.length > 1 && !/^\d+(st|nd|rd|th)?$/.test(t));
    if (!qtok.length) return null;
    // 明显是会议措辞时放宽;否则要求 ≥3 个实词,避免期刊名误配
    if (!/conference|proceedings|symposium|workshop|meeting|congress/.test(base) && qtok.length < 3) return null;
    let best = null;
    for (const c of CCF_CONFS) {
      if (!c.n) continue;
      const set = c._tok || (c._tok = new Set((normalizeName(c.n) + ' ' + normalizeName(c.a)).split(' ')));
      if (qtok.every(t => set.has(t))) {
        if (!best || RANK_ORDER[c.r] < RANK_ORDER[best.r]) best = c;
      }
    }
    return best;
  }

  // CCF 期刊匹配: 精确(全称/缩写) → 词级匹配(容忍缩写前缀,如 trans ⊆ transactions)
  let CCF_JINDEX = null;
  function ccfJournalGetIndex() {
    if (!CCF_JINDEX) {
      const byAbbr = new Map(), byFull = new Map();
      for (const c of CCF_JOURNALS) {
        if (c.a) byAbbr.set(normalizeName(c.a), c);
        if (c.n) byFull.set(normalizeName(c.n), c);
      }
      CCF_JINDEX = { byAbbr: byAbbr, byFull: byFull };
    }
    return CCF_JINDEX;
  }

  function ccfTokenHit(qt, tokens) {
    for (const t of tokens) {
      if (t === qt) return true;
      if (t.length >= 4 && qt.length >= 4 && (qt.indexOf(t) === 0 || t.indexOf(qt) === 0)) return true;
    }
    return false;
  }

  function ccfMatchJournal(name) {
    const idx = ccfJournalGetIndex();
    const s = stripYearTail(normalizeName(name));
    if (!s) return null;
    const exact = idx.byAbbr.get(s) || idx.byFull.get(s);
    if (exact) return exact;

    const qtok = s.split(' ').filter(t => t && t.length > 1);
    if (qtok.length < 2) return null;
    let best = null;
    for (const j of CCF_JOURNALS) {
      if (!j.n && !j.a) continue;
      const tt = j._tok || (j._tok = normalizeName((j.n || '') + ' ' + (j.a || '')).split(' '));
      if (qtok.every(q => ccfTokenHit(q, tt))) {
        if (!best || RANK_ORDER[j.r] < RANK_ORDER[best.r] ||
            (RANK_ORDER[j.r] === RANK_ORDER[best.r] && Math.abs(tt.length - qtok.length) < Math.abs(best._tok.length - qtok.length))) {
          best = j;
        }
      }
    }
    return best;
  }

  // Google Scholar 结果灰行(.gs_a)提取期刊/会议名
  // 例: "J. Smith - Nature Communications, 2021 - nature.com" → "Nature Communications"
  function extractVenueScholar(text) {
    let t = String(text || '').replace(/\u2026/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—]+/, '').trim();
    if (!t) return null;
    const parts = t.split(' - ');
    let venue = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i].trim();
      if (!p || /^https?:/.test(p)) continue;
      if (/(19|20)\d{2}/.test(p)) { venue = p; break; }
    }
    if (!venue) return null;
    venue = stripYearTail(venue);
    if (!venue) return null;
    const confish = /proceedings|conference|symposium|workshop|annual meeting|congress/i.test(venue);
    if (!confish) venue = venue.split(',')[0].trim();
    if (!venue || venue.length < 3 || venue.length > 150) return null;
    return venue;
  }

  // 百度学术来源行提取: 《期刊名》
  function extractVenueBaidu(text) {
    const m = String(text || '').match(/《([^《》]{2,120})》/);
    return m ? m[1].trim() : null;
  }

  // DBLP 条目(cite)提取: "Title. Nature, 52(7585):757–761, 2015." → "Nature"
  function extractVenueDblp(text) {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const dot = t.indexOf('. ');
    let venue = dot !== -1 ? t.slice(dot + 2) : t;
    venue = venue.replace(/\.\s*$/, '').replace(/^in\s+/i, '');
    const segs = venue.split(', ');
    while (segs.length > 1) {
      const seg = segs[segs.length - 1].trim();
      const drop = /^(pp|vol|volume)\b/i.test(seg) ||
        /^(19|20)\d{2}[a-z]?$/.test(seg) ||
        /^\d+\s*\(/.test(seg) ||
        /^\d+\s*[-–:]\s*\d+/.test(seg) ||
        (/\(\d+\)/.test(seg) && /\d\s*[-–]\s*\d/.test(seg));
      if (!drop) break;
      segs.pop();
    }
    venue = segs.join(', ').trim();
    venue = stripYearTail(venue);
    if (!venue || venue.length < 2 || venue.length > 150) return null;
    return venue;
  }

  // IF 展示: 0/空 → 暂无IF(新刊或未公布)
  function formatIF(iff) {
    const s = String(iff == null ? '' : iff).trim();
    if (!s || /^0+(\.0+)?$/.test(s)) return '暂无IF';
    return 'IF:' + s;
  }

  // 解析 LetPub 期刊详情页(公开字段): JCR 分区(取最优 Q)、各版本大类分区、预警名单状态。
  // IF 在详情页需登录才展示,故不从此页取。
  function parseLetPubDetailDocument(doc) {
    if (!doc || !doc.body) return null;
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ');
    const res = { jcr: null, warn: null, editions: parseLetPubZoneEditions(doc) };

    // JCR: "小类:<英文名> Q1"(textContent 里 Q 后可能直接拼着排名数字,如 "AstronomyQ15 / 248")
    const qs = [];
    const re = /小类[:：]\s*([A-Za-z][A-Za-z ,&;()'\/.-]{2,80}?)\s*Q([1-4])(?![a-zA-Z])/g;
    let m;
    while ((m = re.exec(text)) !== null) qs.push(Number(m[2]));
    if (qs.length) res.jcr = 'Q' + Math.min.apply(null, qs);

    // 预警: "期刊分区表预警名单" 之后按 "YYYY年MM月发布…" 分段,取首个非"不在预警名单中"的状态
    const k = text.indexOf('期刊分区表预警名单');
    if (k !== -1) {
      const seg = text.slice(k, k + 1500);
      const parts = seg.split(/(?=\d{4}年\d{2}月发布)/);
      for (const p of parts.slice(1)) {
        const mm = p.match(/发布[^：:]{0,30}[：:]\s*(.+?)(?=\s*\d{4}年\d{2}月发布|$)/);
        if (mm) {
          const status = mm[1].trim();
          if (status && status.indexOf('不在预警名单') === -1) { res.warn = status.slice(0, 60); break; }
        }
      }
    }
    return res;
  }

  // 详情页各版本大类分区。caption td 形如《新锐期刊分区表》（2026年3月发布）/期刊分区表（2025年3月升级版）,
  // 其后继 td 内是对照表;每个格子含三个版本切换 span,无 display:none 的为该版本分区。
  function parseLetPubZoneEditions(doc) {
    const out = [];
    if (!doc || !doc.querySelectorAll) return out;
    for (const td of doc.querySelectorAll('td')) {
      if (td.querySelector('table')) continue;
      const txt = (td.textContent || '').replace(/\s+/g, '');
      let edition = null;
      let m = txt.match(/《新锐期刊分区表》[（(]([^）)]+)[）)]/);
      if (m) edition = '新锐' + m[1];
      else {
        m = txt.match(/^期刊分区表[（(]([^）)]+)[）)]$/);
        if (m) edition = '中科院' + m[1];
      }
      if (!edition) continue;
      let sib = td.nextElementSibling, table = null, hops = 0;
      while (sib && hops < 3) {
        const t = sib.querySelector('table');
        if (t && [...t.querySelectorAll('th')].some(th => (th.textContent || '').indexOf('Top期刊') !== -1)) { table = t; break; }
        sib = sib.nextElementSibling; hops++;
      }
      if (!table) continue;
      const rows = [...table.querySelectorAll('tr')].filter(r => [...r.children].some(c => c.tagName === 'TD' && !c.querySelector('table')));
      const mainRow = rows[0];
      if (!mainRow) continue;
      const cells = [...mainRow.children].filter(c => c.tagName === 'TD');
      const bigTd = cells[0];
      if (!bigTd) continue;
      const spans = [...bigTd.querySelectorAll('span')];
      const vis = spans.filter(s => !/display\s*:\s*none/.test(s.getAttribute('style') || ''));
      const zone = vis.length ? vis[0].textContent.trim() : null;
      if (!zone || !/^[1-4]区$/.test(zone)) continue;
      const top = cells[2] ? cells[2].textContent.trim() : '';
      out.push({ edition: edition, zone: zone, top: top === '是' });
      if (out.length >= 4) break;
    }
    return out;
  }

  /* <<< PURE-LOGIC <<< */

  /* ============================ 站点识别 ============================ */

  function siteKind(host) {
    const h = String(host || '').toLowerCase();
    if (/scholar\.google\./.test(h) || /lanfanshu|panda321|panda985|sc-handsome/.test(h)) return 'scholar';
    if (/xueshu\.baidu\.com$/.test(h)) return 'baidu';
    if (/(^|\.)dblp\.(org|uni-trier\.de)$/.test(h)) return 'dblp';
    return null;
  }

  /* ============================ 缓存/限速 ============================ */

  let CACHE = null;
  function cacheLoad() {
    try { CACHE = JSON.parse(GM_getValue('lpfq_cache', '{}')) || {}; }
    catch (e) { CACHE = {}; }
  }
  function cacheGet(key) {
    const e = CACHE[key];
    if (!e) return null;
    if (Date.now() - e.t > CFG.cacheTTLms) { delete CACHE[key]; return null; }
    return e.v;
  }
  function cacheSet(key, v) {
    CACHE[key] = { t: Date.now(), v: v };
    const ks = Object.keys(CACHE);
    if (ks.length > CFG.cacheMax) {
      ks.sort((a, b) => CACHE[a].t - CACHE[b].t)
        .slice(0, ks.length - CFG.cacheMax)
        .forEach(x => delete CACHE[x]);
    }
    try { GM_setValue('lpfq_cache', CACHE); } catch (e) {}
  }

  let chain = Promise.resolve();
  let lastReq = 0;
  function enqueue(fn) {
    const run = chain.then(async () => {
      const wait = Math.max(0, CFG.requestGapMs - (Date.now() - lastReq));
      if (wait) await new Promise(r => setTimeout(r, wait));
      lastReq = Date.now();
      return fn();
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /* ============================ LetPub 查询 ============================ */

  let cooldownUntil = 0;
  function triggerCooldown() {
    cooldownUntil = Date.now() + CFG.cooldownMs;
  }

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      const xf = (typeof GM_xmlhttpRequest === 'function' && GM_xmlhttpRequest) ||
        (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' && GM.xmlHttpRequest);
      if (!xf) return reject(new Error('NO_GM_XHR'));
      xf({
        method: 'GET',
        url: url,
        timeout: 20000,
        headers: {
          'Referer': 'https://www.letpub.com.cn/index.php?page=journalapp',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        onload: r => {
          if (r.status >= 200 && r.status < 300) resolve(r.responseText);
          else reject(new Error('HTTP ' + r.status));
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('请求超时'))
      });
    });
  }

  function letpubSearchUrl(name) {
    return 'https://www.letpub.com.cn/index.php?page=journalapp&view=search' +
      '&searchname=' + encodeURIComponent(name) +
      '&searchissn=&searchfield=&searchimpactlow=&searchimpacthigh=&searchimpacttrend=' +
      '&searchscitype=&searchcategory1=&searchcategory2=&searchjcrkind=&searchopenaccess=' +
      '&searchsort=relevance&searchsortorder=desc&currentsearchpage=1';
  }

  // 返回 {type:'conf'|'journal'|'none', query, conf?, best?, list?}
  async function lookupVenue(query) {
    const q = String(query || '').trim();
    if (!q) throw new Error('查询词为空');

    const conf = ccfMatch(q);
    if (conf) return { type: 'conf', query: q, conf: { a: conf.a, n: conf.n, r: conf.r, c: conf.c } };

    const key = 'v2:' + normalizeName(q); // v1.1.0 起缓存结构含版本化分区与 CCF 字段,旧键作废
    const hit = key ? cacheGet(key) : null;
    if (hit) return hit;

    if (Date.now() < cooldownUntil) throw new Error('LetPub 冷却中,请' + Math.ceil((cooldownUntil - Date.now()) / 60000) + '分钟后再试');
    if (!key) return { type: 'none', query: q };

    const res = await enqueue(async () => {
      const html = await gmFetchText(letpubSearchUrl(q));
      // 注意: LetPub 正常结果页内嵌的登录弹窗里也有"验证码"字样,
      // 只有当响应完全不是搜索结果页时才判定为风控
      const looksLikeSearchPage = /journallisttable|搜索条件匹配/.test(html);
      if (!looksLikeSearchPage && /验证码|访问过于频繁|系统检测到异常/.test(html)) {
        triggerCooldown();
        throw new Error('LetPub 触发访问限制,请稍后在浏览器打开 letpub.com.cn 完成验证后重试');
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const entries = parseLetPubSearchDocument(doc);
      const best = pickBestLetPub(entries, q);
      const ccfJournal = ccfMatchJournal(q);
      if (best || ccfJournal) {
        return {
          type: 'journal', query: q, best: best, list: entries.slice(0, 8),
          ccfJournal: ccfJournal ? { a: ccfJournal.a, n: ccfJournal.n, r: ccfJournal.r, c: ccfJournal.c } : null
        };
      }
      return { type: 'none', query: q };
    });
    cacheSet(key, res);
    return res;
  }

  // 详情页(公开的 JCR/Top/预警)查询,走同一限速队列
  async function fetchJournalDetail(entry) {
    try {
      const html = await enqueue(() => gmFetchText(entry.url));
      if (/验证码|访问过于频繁|系统检测到异常/.test(html) && !/journalid/.test(html)) {
        triggerCooldown();
        return null;
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return parseLetPubDetailDocument(doc);
    } catch (e) {
      return null;
    }
  }

  // 详情字段补全后回写缓存
  function cacheWriteBack(q, res) {
    const key = 'v2:' + normalizeName(q || '');
    if (!key || !CACHE[key] || !CACHE[key].v) return;
    CACHE[key].v = res;
    try { GM_setValue('lpfq_cache', CACHE); } catch (e) {}
  }

  /* ============================ UI ============================ */

  const ZONE_COLOR = { '1区': '#d93025', '2区': '#e8710a', '3区': '#1a73e8', '4区': '#6b7280' };
  const CONF_COLOR = { A: '#d93025', B: '#e8710a', C: '#1a73e8' };

  const CSS_TEXT = `
:host{all:initial}
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,'Segoe UI','Microsoft YaHei',system-ui,sans-serif}
#lpSelBtn{position:fixed;z-index:2147483647;background:#111827;color:#fff;font-size:12px;line-height:1;padding:8px 12px;border-radius:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);user-select:none}
#lpSelBtn:hover{background:#2563eb}
#lpPanel{position:fixed;z-index:2147483647;width:390px;max-width:94vw;background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.22);font-size:13px;overflow:hidden}
.hd{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;cursor:move;user-select:none;touch-action:none}
.ttl{font-weight:700;flex:1}
#lpExt{color:#2563eb;text-decoration:none;font-size:12px;white-space:nowrap}
#lpClose{cursor:pointer;color:#6b7280;padding:0 4px;font-size:16px;line-height:1}
.inrow{display:flex;gap:6px;padding:8px 12px}
#lpInput{flex:1;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:13px;outline:none;background:#fff;color:#1f2937}
#lpInput:focus{border-color:#2563eb}
#lpGo{border:0;background:#2563eb;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px}
#lpRes{max-height:330px;overflow:auto;padding:4px 12px 8px}
.item{padding:8px 0;border-bottom:1px dashed #eee}
.item:last-child{border-bottom:0}
.r1{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.chip{color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;line-height:1.2;flex:none}
.r1 a{color:#111827;font-weight:600;text-decoration:none;font-size:13px;word-break:break-all}
.r1 a:hover{color:#2563eb;text-decoration:underline}
.r2{color:#6b7280;font-size:12px;margin-top:3px}
.other{color:#6b7280;font-size:12px;padding:6px 0;border-bottom:1px dashed #eee}
.other:last-child{border-bottom:0}
.other a{color:#4b5563}
.hint{color:#9ca3af;font-size:12px;padding:6px 0;line-height:1.5}
.hint a{color:#2563eb}
.err{color:#b91c1c;font-size:12px;padding:6px 0;line-height:1.5}
.ft{border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;padding:5px 12px;background:#fafafa}
.spin{display:inline-block;width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:lpspin .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes lpspin{to{transform:rotate(360deg)}}
`;

  const BADGE_CSS = 'display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;line-height:17px;cursor:pointer;color:#fff;white-space:nowrap;vertical-align:1px;';

  let ui = null;
  let currentQuery = '';

  function ensureUI() {
    if (ui && ui.host.isConnected) return ui;
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const sh = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      sh.adoptedStyleSheets = [sheet];
    } catch (e) {
      const st = document.createElement('style');
      st.textContent = CSS_TEXT;
      sh.appendChild(st);
    }
    sh.innerHTML =
      '<div id="lpSelBtn" hidden>🔍 查分区</div>' +
      '<div id="lpPanel" hidden>' +
      '  <div class="hd"><span class="ttl">分区查询</span><a id="lpExt" target="_blank" rel="noreferrer">LetPub ↗</a><span id="lpClose" title="关闭">×</span></div>' +
      '  <div class="inrow"><input id="lpInput" placeholder="输入期刊或会议名"><button id="lpGo">查询</button></div>' +
      '  <div id="lpRes"></div>' +
      '  <div class="ft">分区:LetPub(新锐/中科院历版) · CCF 第七版目录(内嵌,含期刊)</div>' +
      '</div>';

    const selbtn = sh.getElementById('lpSelBtn');
    const panel = sh.getElementById('lpPanel');
    const input = sh.getElementById('lpInput');
    const res = sh.getElementById('lpRes');
    const ext = sh.getElementById('lpExt');
    sh.getElementById('lpClose').addEventListener('click', closePanel);
    sh.getElementById('lpGo').addEventListener('click', () => runQuery(input.value));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') runQuery(input.value); });
    selbtn.addEventListener('mousedown', ev => ev.preventDefault());
    selbtn.addEventListener('click', () => openPanel(currentQuery, selbtn.getBoundingClientRect()));
    panel.addEventListener('mousedown', ev => ev.stopPropagation());

    // 面板拖动: 按住标题栏拖动(标题栏里的链接和关闭按钮除外)
    panel.addEventListener('pointerdown', ev => {
      if (ev.target.closest && (ev.target.closest('a') || ev.target.closest('#lpClose'))) return;
      if (panel.hidden) return;
      ev.preventDefault();
      const rect = panel.getBoundingClientRect();
      const ox = ev.clientX - rect.left, oy = ev.clientY - rect.top;
      const move = e2 => {
        const w = panel.offsetWidth || 390;
        let x = e2.clientX - ox, y = e2.clientY - oy;
        x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
        y = Math.max(8, Math.min(y, window.innerHeight - 40));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    });

    document.documentElement.appendChild(host);
    ui = { host: host, shadow: sh, selbtn: selbtn, panel: panel, input: input, res: res, ext: ext };
    return ui;
  }

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === 'style') el.style.cssText = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (!kid) continue;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return el;
  }

  /* ---------- 划词按钮 ---------- */

  let selHideTimer = null;

  function initSelection() {
    if (!CFG.enableSelectionButton) return;
    document.addEventListener('selectionchange', () => {
      clearTimeout(selHideTimer);
      selHideTimer = setTimeout(updateSelButton, 350);
    });
    window.addEventListener('scroll', () => { if (ui) ui.selbtn.hidden = true; }, true);
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { closePanel(); if (ui) ui.selbtn.hidden = true; }
    });
    document.addEventListener('pointerdown', ev => {
      if (!ui || ui.panel.hidden) return;
      if (!ev.composedPath().includes(ui.host)) closePanel();
    }, true);
  }

  function updateSelButton() {
    const u = ensureUI();
    let text = null, rect = null;

    // 1) 页面正文选区(包括富文本编辑器如飞书文档/语雀/腾讯文档;仅忽略自己面板内的选择)
    let sel = null;
    try { sel = window.getSelection(); } catch (e) {}
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const t = (sel.toString() || '').trim();
      if (t.length >= 2 && t.length <= 150) {
        const node = sel.anchorNode;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        const root = el && el.getRootNode ? el.getRootNode() : null;
        if (root !== ui.shadow) {
          let r;
          try { r = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) {}
          if (r && (r.width || r.height)) { text = t; rect = r; }
        }
      }
    }

    // 2) 输入框内选区(搜索框里选中刚输入的期刊名)
    if (text === null) {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
          ae.type !== 'password' && typeof ae.selectionStart === 'number' &&
          ae.selectionStart !== ae.selectionEnd) {
        const t = String(ae.value || '').slice(ae.selectionStart, ae.selectionEnd).trim();
        if (t.length >= 2 && t.length <= 150) { text = t; rect = ae.getBoundingClientRect(); }
      }
    }

    if (text === null) { u.selbtn.hidden = true; return; }

    currentQuery = text;
    u.selbtn.hidden = false;
    const x = Math.max(8, Math.min((rect.right || 60) + 8, window.innerWidth - 100));
    const y = Math.max(8, Math.min((rect.bottom || 60) + 6, window.innerHeight - 36));
    u.selbtn.style.left = x + 'px';
    u.selbtn.style.top = y + 'px';
  }

  /* ---------- 结果面板 ---------- */

  function openPanel(text, anchorRect) {
    const u = ensureUI();
    u.panel.hidden = false;
    u.selbtn.hidden = true;
    currentQuery = text || '';
    u.input.value = currentQuery;
    positionPanel(anchorRect);
    if (currentQuery) {
      runQuery(currentQuery);
    } else {
      u.res.textContent = '';
      u.res.appendChild(h('div', { class: 'hint', text: '输入或粘贴期刊/会议名,点「查询」;也可以先在页面上划词选中名称再从右键菜单 Tampermonkey → 查分区 打开。' }));
    }
  }

  // 右键菜单入口(出现在右键菜单的 Tampermonkey 分组下)
  function menuQuery() {
    let text = '';
    try { text = (window.getSelection() || '').toString().trim(); } catch (e) {}
    if (text.length < 2 || text.length > 150) text = '';
    openPanel(text, null);
  }

  function registerMenuCommand() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const caption = '🔍 查分区(先划词选中期刊/会议名)';
    try {
      GM_registerMenuCommand(caption, menuQuery, { id: 'lpfq-menu', autoClose: true });
    } catch (e) {
      try { GM_registerMenuCommand(caption, menuQuery, 'L'); } catch (e2) {}
    }
  }

  function closePanel() {
    if (ui) ui.panel.hidden = true;
  }

  function positionPanel(anchor) {
    const u = ensureUI();
    const p = u.panel;
    p.style.visibility = 'hidden';
    p.hidden = false;
    requestAnimationFrame(() => {
      const w = p.offsetWidth || 390, ph = p.offsetHeight || 300;
      let x = Math.max(8, (window.innerWidth - w) / 2), y = 90;
      if (anchor && anchor.left !== undefined) {
        x = anchor.left;
        y = anchor.bottom + 8;
        if (y + ph > window.innerHeight - 10) y = Math.max(10, anchor.top - ph - 8);
      }
      x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
      y = Math.max(8, Math.min(y, window.innerHeight - 80));
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.visibility = 'visible';
    });
  }

  function runQuery(text) {
    const u = ensureUI();
    const q = String(text || '').trim();
    currentQuery = q;
    u.ext.href = letpubSearchUrl(q || ' ');
    const box = u.res;
    box.textContent = '';
    box.appendChild(h('div', { class: 'hint' }, h('span', { class: 'spin' }), '正在查询 LetPub / CCF 目录…'));
    lookupVenue(q)
      .then(r => renderResult(box, r))
      .catch(err => {
        box.textContent = '';
        const msg = err && err.message === 'NO_GM_XHR'
          ? '未检测到 GM_xmlhttpRequest 权限:请在 Tampermonkey 中允许本脚本跨域访问 letpub.com.cn(弹出授权时选择「总是允许」)。'
          : (err && err.message) || '查询失败';
        box.appendChild(h('div', { class: 'err', text: '⚠ ' + msg }));
      });
  }

  function chip(text, color, title) {
    const el = h('span', { class: 'chip', style: 'background:' + color, text: text });
    if (title) el.title = title;
    return el;
  }

  function zoneChip(zone, iff) {
    if (zone) return chip('新锐' + zone, ZONE_COLOR[zone] || '#6b7280', '新锐分区表(LetPub 当前展示版本,2026.3 起)');
    if (iff && !/^0+(\.0+)?$/.test(String(iff))) return chip('IF ' + iff, '#6b7280');
    return chip('未分区', '#9ca3af');
  }

  function journalItem(e) {
    const r2 = [e.abbr, e.big && '大类:' + e.big, e.sub && '小类:' + e.sub, formatIF(e.iff)]
      .filter(Boolean).join(' · ');
    const r3 = [e.sci, e.oa, e.review && '审稿:' + e.review, e.accept && '录用:' + e.accept]
      .filter(Boolean).join(' · ');
    return h('div', { class: 'item' },
      h('div', { class: 'r1' }, zoneChip(e.zone, e.iff), h('a', { href: e.url, target: '_blank', rel: 'noreferrer', text: e.name || '(未知名)' })),
      r2 ? h('div', { class: 'r2', text: r2 }) : null,
      r3 ? h('div', { class: 'r2', text: r3 }) : null);
  }

  // 版本名缩写: 中科院2025年3月升级版 → 中科院2025.3;新锐2026年3月发布 → 新锐2026.3
  function shortEdition(t) {
    return String(t || '')
      .replace(/(\d{4})年(\d+)月/, '$1.$2')
      .replace(/旧的?升级版|升级版|发布/g, '')
      .replace(/\s+/g, '');
  }

  // 详情页字段到位后,往条目第一行补各版本分区/JCR/预警 徽章
  function attachDetailChips(itemEl, e) {
    if (!itemEl || !e || !e.detail) return;
    const r1 = itemEl.querySelector('.r1');
    if (!r1) return;
    const d = e.detail;
    for (const ed of (d.editions || [])) {
      const lab = shortEdition(ed.edition);
      if (lab.indexOf('新锐') === 0) continue; // 列表分区 chip 已展示新锐版
      const isCAS25 = lab.indexOf('中科院2025.3') !== -1;
      r1.appendChild(chip(lab + ' ' + ed.zone + (isCAS25 && ed.top ? '·Top' : ''),
        ZONE_COLOR[ed.zone] || '#6b7280', ed.edition + (ed.top ? ' · Top 期刊' : '')));
    }
    if (d.jcr) r1.appendChild(chip('JCR ' + d.jcr, '#7c3aed'));
    if (d.warn) r1.appendChild(chip('⚠ 预警', '#dc2626', d.warn));
  }

  function renderResult(box, r) {
    box.textContent = '';
    if (r.type === 'conf') {
      const c = r.conf;
      box.appendChild(h('div', { class: 'item' },
        h('div', { class: 'r1' },
          h('span', { class: 'chip', style: 'background:' + (CONF_COLOR[c.r] || '#6b7280'), text: 'CCF-' + c.r }),
          h('span', { style: 'font-weight:600', text: c.a }),
          h('span', { class: 'hint', text: 'CCF 推荐会议' })),
        c.n ? h('div', { class: 'r2', text: c.n }) : null,
        c.c ? h('div', { class: 'r2', text: '领域:' + c.c }) : null));
      box.appendChild(h('div', { class: 'hint', text: '会议不在 LetPub 期刊库中,等级来自内嵌 CCF 推荐会议目录(数据源 ccfddl,含 2025 第七版)。' }));
      return;
    }

    const items = (r.list && r.list.length ? r.list : (r.best ? [r.best] : []));
    if (!items.length) {
      if (r.ccfJournal) {
        box.appendChild(h('div', { class: 'item' },
          h('div', { class: 'r1' },
            chip('CCF-' + r.ccfJournal.r + '期刊', '#4f46e5'),
            h('span', { style: 'font-weight:600', text: r.ccfJournal.n || r.ccfJournal.a || '' })),
          r.ccfJournal.c ? h('div', { class: 'r2', text: '领域:' + r.ccfJournal.c }) : null));
      }
      const confish = /conference|proceedings|symposium|workshop|meeting|congress/i.test(r.query || '');
      box.appendChild(h('div', { class: 'hint' },
        'LetPub 未收录「' + (r.query || '') + '」。' + (confish
          ? '看起来是会议:LetPub 只收录期刊;CCF 推荐目录(第七版)中也没有匹配到,可能是 C 类以下或非 CCF 会议。'
          : '可能是拼写有差异,可在 LetPub 手动确认。'),
        h('br'), h('a', { href: letpubSearchUrl(r.query || ''), target: '_blank', rel: 'noreferrer', text: '在 LetPub 打开搜索 ↗' })));
      return;
    }

    const best = r.best && items.indexOf(r.best) !== -1 ? r.best : items[0];
    const b = journalItem(best);
    b.classList.add('best');
    box.appendChild(b);
    if (r.ccfJournal) {
      const r1 = b.querySelector('.r1');
      if (r1) r1.appendChild(chip('CCF-' + r.ccfJournal.r + '期刊', '#4f46e5',
        (r.ccfJournal.n || r.ccfJournal.a) + ' · CCF 推荐期刊(第七版)'));
    }
    if (best && best.url && best.url.indexOf('view=detail') !== -1) {
      const enrich = () => attachDetailChips(b, best);
      if (best.detail) enrich();
      else fetchJournalDetail(best).then(d => {
        if (!d) return;
        best.detail = d;
        cacheWriteBack(r.query || currentQuery, r);
        enrich();
      }).catch(() => {});
    }
    for (const e of items) {
      if (e === best) continue;
      const row = h('div', { class: 'other' },
        h('span', { style: 'color:' + (e.zone ? (ZONE_COLOR[e.zone] || '#6b7280') : '#9ca3af'), text: e.zone ? e.zone : '—' }),
        ' ',
        h('a', { href: e.url, target: '_blank', rel: 'noreferrer', text: e.name }));
      box.appendChild(row);
    }
  }

  /* ============================ 徽标注入 ============================ */

  function makeBadge(label, color, title, query) {
    const el = document.createElement('span');
    el.className = 'lp-fq-badge';
    el.style.cssText = BADGE_CSS + 'background:' + color + ';';
    el.textContent = label;
    el.title = title || label;
    el.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
    el.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openPanel(query, el.getBoundingClientRect());
    });
    return el;
  }

  function attachBadge(node, res, venueText) {
    if (!node || !node.parentNode && node.nodeType !== 1) return;
    let label = null, color = '#6b7280', title = '';
    if (res.type === 'conf') {
      label = 'CCF-' + res.conf.r;
      color = CONF_COLOR[res.conf.r] || '#6b7280';
      title = res.conf.a + (res.conf.n ? ' · ' + res.conf.n : '') + '(CCF 推荐会议)';
    } else if (res.type === 'journal' && res.best) {
      const e = res.best;
      if (e.zone) { label = '新锐' + e.zone; color = ZONE_COLOR[e.zone] || '#6b7280'; }
      else if (e.iff && !/^0+(\.0+)?$/.test(String(e.iff))) { label = 'IF ' + e.iff; color = '#6b7280'; }
      else if (CFG.showUnmatched) { label = '未分区'; color = '#9ca3af'; }
      title = (e.name || '') + (e.zone ? ' · 新锐分区表2026.3(LetPub 当前展示)' : '') + ' · 点面板看中科院 2025.3 版与 CCF';
      if (!label && !CFG.showUnmatched) return;
    } else {
      if (!CFG.showUnmatched) return;
      label = '未收录';
      color = '#9ca3af';
    }
    const el = makeBadge(label, color, title, venueText);
    if (node.tagName === 'CITE' && node.parentNode) {
      node.parentNode.insertBefore(el, node.nextSibling);
    } else {
      node.appendChild(el);
    }
  }

  const SCAN_SELECTOR = {
    scholar: '.gs_a:not([data-lpfq])',
    baidu: '.sc_info:not([data-lpfq])',
    dblp: 'cite:not([data-lpfq])'
  };

  function extractVenue(kind, text) {
    try {
      if (kind === 'scholar') return extractVenueScholar(text);
      if (kind === 'baidu') return extractVenueBaidu(text);
      if (kind === 'dblp') return extractVenueDblp(text);
    } catch (e) {}
    return null;
  }

  let warnedNoXhr = false;
  function warnLookupFail(err) {
    if (err && err.message === 'NO_GM_XHR' && !warnedNoXhr) {
      warnedNoXhr = true;
      try { console.warn('[LP分区助手] 缺少 GM_xmlhttpRequest 权限,无法向 LetPub 发起查询;请在 Tampermonkey 中检查脚本授权'); } catch (e) {}
    }
    if (CFG.debug && err) console.warn('[LP分区助手]', err.message);
  }

  function processScope(kind) {
    if (!CFG.enableAutoBadges) return;
    let nodes = null;
    try { nodes = document.querySelectorAll(SCAN_SELECTOR[kind]); } catch (e) { return; }
    if (nodes && nodes.length) {
      for (const node of nodes) {
        node.setAttribute('data-lpfq', '1');
        const v = extractVenue(kind, node.textContent);
        if (!v) continue;
        lookupVenue(v).then(res => attachBadge(node, res, v)).catch(warnLookupFail);
      }
    }
    // 百度学术兜底: 结果块扫描《…》
    if (kind === 'baidu') {
      let blocks = null;
      try { blocks = document.querySelectorAll('.sc_default:not([data-lpfq]), .result:not([data-lpfq])'); } catch (e) {}
      if (blocks) {
        for (const block of blocks) {
          block.setAttribute('data-lpfq', '1');
          const info = block.querySelector('.sc_info') || block;
          const v = extractVenueBaidu(info.textContent);
          if (!v) continue;
          lookupVenue(v).then(res => attachBadge(info, res, v)).catch(() => {});
        }
      }
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function initBadges(kind) {
    const scan = debounce(() => processScope(kind), 900);
    const root = document.body || document.documentElement;
    if (root && window.MutationObserver) {
      new MutationObserver(scan).observe(root, { childList: true, subtree: true });
    }
    scan();
  }

  /* ============================ 启动 ============================ */

  function main() {
    cacheLoad();
    const kind = siteKind(location.hostname);
    if (kind) initBadges(kind);
    initSelection();
    registerMenuCommand();
    if (CFG.debug) console.log('[LP分区助手] ready, site kind =', kind);
  }

  main();
})();
