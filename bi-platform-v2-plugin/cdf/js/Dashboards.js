 $.ajaxSetup({
  type: "POST",
  async: false,
  traditional: true,
  scriptCharset: "utf-8",
  contentType: "application/x-www-form-urlencoded;charset=UTF-8"
});



var pathArray = window.location.pathname.split( '/' );
var webAppPath;
if (!(typeof(CONTEXT_PATH) == 'undefined')){
  webAppPath = CONTEXT_PATH;
}
if(webAppPath == undefined){
  webAppPath = "/" + pathArray[1];
}

if(webAppPath.endsWith("/")) {
  webAppPath = webAppPath.substr(0, webAppPath.length-1);
}

var GB_ANIMATION = true;
var CDF_CHILDREN = 1;
var CDF_SELF = 2;
var ERROR_IMAGE = webAppPath + "/content/pentaho-cdf/resources/style/images/error.png";
var CDF_ERROR_DIV = 'cdfErrorDiv';


if($.blockUI){
  $.blockUI.defaults.fadeIn = 0;
  $.blockUI.defaults.message = '<div style="padding: 0px;"><img src="' + webAppPath + '/content/pentaho-cdf/resources/style/images/processing_transparent.gif" />';
  $.blockUI.defaults.css.left = '50%';
  $.blockUI.defaults.css.top = '40%';
  $.blockUI.defaults.css.marginLeft = '-16px';
  $.blockUI.defaults.css.width = '32px';
  $.blockUI.defaults.css.background = 'none';
  $.blockUI.defaults.overlayCSS = { backgroundColor: "#FFFFFF", opacity: 0.8, cursor: "wait"};
  $.blockUI.defaults.css.border = "none";
}

var ERROR_CODES = [];
ERROR_CODES["UNKNOWN"] = ["ERROR: ","resources/style/images/error.jpg"];
ERROR_CODES["0012"] = ["No data available (MDXLookupRule did not execute successfully)","resources/style/images/alert.jpg"];
ERROR_CODES["0006"] = ["Could not establish a connection to the database","resources/style/images/error.jpg"];


if (typeof $.SetImpromptuDefaults == 'function')
  $.SetImpromptuDefaults({
    prefix: 'colsJqi',
    show: 'slideDown'
  });

var Dashboards = {
  parameterModel: new Backbone.Model(),
  TRAFFIC_RED: webAppPath + "/content/pentaho-cdf/resources/style/images/traffic_red.png",
  TRAFFIC_YELLOW: webAppPath + "/content/pentaho-cdf/resources/style/images/traffic_yellow.png",
  TRAFFIC_GREEN: webAppPath + "/content/pentaho-cdf/resources/style/images/traffic_green.png",
  viewFlags: {
    UNUSED: "unused",
    UNBOUND: "unbound",
    VIEW: "view"
  },
  /* globalContext determines if components and params are retrieved
   * from the current window's object or from the Dashboards singleton
   */
  globalContext: true,
  escapeParameterValues : true,
  /* Used to control progress indicator for async mode */
  runningCalls: 0,
  components: [],
  /* Holds the dashboard parameters if globalContext = false */
  parameters: [],
  
  // Holder for context
  context:{},
  
  /* measures, in miliseconds, the delay between firing blockUI and
   * actually updating the dashboard. Necessary for IE/Chrome. Higher
   * values have better chances of working, but are (obviously) slower
   */
  renderDelay: 300,
  args: [],
  monthNames : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  /* Reference to current language code . Used in every place where jquery
   * plugins used in CDF hasm native internationalization support (ex: Datepicker)
   */
  i18nCurrentLanguageCode : null,
  i18nSupport : null  // Reference to i18n objects
};

_.extend(Dashboards, Backbone.Events);

// Log
Dashboards.log = function(m,type){
  if (typeof console != "undefined" ){
    if (type && console[type]) {
      console[type]("CDF: " + m);
    }else if (type === 'exception' &&
      !console.exception) {
      console.error(m.stack);
    }
    else {
      console.log("CDF: " + m);
    }
  }
};

Dashboards.error = function(m){
  this.log(m, 'error');
}

// REFRESH ENGINE begin

Dashboards.RefreshEngine = function(){// Manages periodic refresh of components

  var NO_REFRESH = 0;//currently no distinction between explicitly disabled or not set
  var refreshQueue = new Array();//component refresh queue
  var activeTimer = null;//timer for individual component refresh

  var globalRefreshPeriod = NO_REFRESH;
  var globalTimer = null;

  Dashboards.RefreshEngine.QueueItem = function() {
    return {
      nextRefresh : 0,
      component : null
    };
  };

  //set global refresh and (re)start interval
  var startGlobalRefresh = function(refreshPeriod){
    if (globalTimer != null) {
      clearInterval(globalTimer);
      globalTimer = null;
    }
    globalRefreshPeriod = (refreshPeriod >0)? refreshPeriod : NO_REFRESH;
    if(globalRefreshPeriod != NO_REFRESH){
      globalTimer = setInterval("Dashboards.refreshEngine.fireGlobalRefresh()",globalRefreshPeriod * 1000);//ToDo: cleaner way to call
    }
  };

  var clearFromQueue = function(component){
    for (var i = 0; i < refreshQueue.length; i++) {
      if (refreshQueue[i].component == component) {
        refreshQueue.splice(i,1);
        i--;
      }
    }
  };

  var clearQueue = function(){
    if(refreshQueue.length > 0) refreshQueue.splice(0,refreshQueue.length);
  };

  //binary search for elem's position in coll (nextRefresh asc order)
  var getSortedInsertPosition = function(coll, elem){
    var high = coll.length - 1;
    var low = 0;
    var mid;

    while (low <= high) {
      mid = parseInt((low + high) / 2)
      if (coll[mid].nextRefresh > elem.nextRefresh) {
        high = mid - 1;
      } else if (coll[mid].nextRefresh < elem.nextRefresh) {
        low = mid + 1;
      } else {//==
        return mid;
      }
    }
    return low;
  };
  var sortedInsert = function(rtArray,rtInfo){
    var pos = getSortedInsertPosition(rtArray,rtInfo);
    rtArray.splice(pos,0,rtInfo);
  };

  var stopTimer = function(){
    if (activeTimer != null) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
  };

  var restartTimer = function(){
    stopTimer();
    Dashboards.refreshEngine.fireRefresh();
  };

  var getCurrentTime = function (){
    var date = new Date();
    return date.getTime();
  };

  var isFirstInQueue = function(component){
    return refreshQueue.length > 0 && refreshQueue[0].component == component;
  };

  var refreshComponent = function(component){
    //if refresh period is too short, progress indicator will stay in user's face
    //		let(Dashboards.runningCalls = 0){
    Dashboards.update(component);
  //			Dashboards.runningCalls = 0;
  //			Dashboards.hideProgressIndicator()
  //		}
  };

  var insertInQueue = function(component){
    var time = getCurrentTime();
    // normalize invalid refresh
    if (!(component.refreshPeriod > 0)) {
      component.refreshPeriod = NO_REFRESH;
    }
    if (component.refreshPeriod != NO_REFRESH) {
      //get next refresh time for component
      var info = new Dashboards.RefreshEngine.QueueItem();
      info.nextRefresh = time + (component.refreshPeriod * 1000);
      info.component = component;
      sortedInsert(refreshQueue, info);
    }
  };
  return {

    //set a component's refresh period and clears it from the queue if there;
    //processComponent must be called to activate the refresh timer for the component
    registerComponent : function(component, refreshPeriod){
      if(!component) return false;

      component.refreshPeriod = (refreshPeriod > 0)? refreshPeriod : NO_REFRESH;
      var wasFirst =  isFirstInQueue(component);
      clearFromQueue(component);
      if(wasFirst) restartTimer();

      return true;
    },

    getRefreshPeriod : function(component){
      if(component && component.refreshPeriod > 0) return component.refreshPeriod;
      else return NO_REFRESH;
    },

    //sets next refresh for given component and inserts it in refreshQueue, restarts timer if needed
    processComponent : function(component){
      clearFromQueue(component);
      insertInQueue(component);
      if(isFirstInQueue(component)) restartTimer();
      return true;//dbg
    },

    //clears queue, sets next refresh for all components, restarts timer
    processComponents : function(){
      clearQueue();
      for(var i=0; i<Dashboards.components.length;i++){
        insertInQueue(Dashboards.components[i]);
      }
      restartTimer();
      return true;//dbg
    },

    //pop due items from queue, refresh components and set next timeout
    fireRefresh : function(){
      activeTimer = null;
      var currentTime = getCurrentTime();

      while(refreshQueue.length > 0 &&
        refreshQueue[0].nextRefresh <= currentTime){
        var info = refreshQueue.shift();//pop first
        //call update, which calls processComponent
        refreshComponent(info.component);
      }
      if(refreshQueue.length > 0){
        activeTimer = setTimeout("Dashboards.refreshEngine.fireRefresh()", refreshQueue[0].nextRefresh - currentTime );//ToDo: cleaner way to call
      //activeTimer = setTimeout(this.fireRefresh, refreshQueue[0].nextRefresh - currentTime );
      }
    },

    // called when a valid globalRefreshPeriod exists
    // updates all components without their own refresh period
    fireGlobalRefresh: function(){
      for(i=0;i<Dashboards.components.length;i++){
        var comp = Dashboards.components[i];
        if (!(comp.refreshPeriod > 0) //only update those without refresh
          && comp.type != "select") { //and that are not pov widgets
          refreshComponent(comp);
        }
      }
    },

    setGlobalRefresh : function(refreshPeriod){
      startGlobalRefresh(refreshPeriod);
    },

    getQueue : function(){
      return refreshQueue;
    }
  };
};

Dashboards.refreshEngine = new Dashboards.RefreshEngine();

//REFRESH ENGINE end

Dashboards.setGlobalContext = function(globalContext) {
  this.globalContext = globalContext;
};

Dashboards.showProgressIndicator = function() {
  this.blockUIwithDrag();
};

Dashboards.hideProgressIndicator = function() {
  if(this.runningCalls <= 0){
    $.unblockUI();
    this.showErrorTooltip();
  }
};

Dashboards.incrementRunningCalls = function() {
  this.runningCalls++ ;
  this.showProgressIndicator();
//Dashboards.log("+Running calls incremented to: " + Dashboards.runningCalls);
};

Dashboards.decrementRunningCalls = function() {
  this.runningCalls-- ;
  //Dashboards.log("-Running calls decremented to: " + Dashboards.runningCalls);
  setTimeout(_.bind(function(){
    if(this.runningCalls<=0){
      this.hideProgressIndicator();
      this.runningCalls = 0; // Just in case
    }
  },this),10);
};

Dashboards.bindControl = function(object) {

  // see if there is a class defined for this object
  var objectType = typeof object["type"]=='function'?object.type():object.type;
  var classNames = [
  // try TypeComponent as class name
  objectType.substring(0,1).toUpperCase() + objectType.substring(1) + 'Component',
  // try type as class name
  objectType,
  // try Type as class name with first letter uppercase
  objectType.substring(0,1).toUpperCase() + objectType.substring(1)
  ];
  
  var objectImpl;
  for (var i = 0; i < classNames.length && (objectImpl == null || typeof objectImpl == 'undefined'); i++) {
    try {
      eval('objectImpl = new ' + classNames[i]);
    } catch (e) {
    }
  }
  
  if (typeof objectImpl == 'undefined'){
    this.log ("Object type " + object["type"] + " can't be mapped to a valid class","error");
  } else {
    objectImpl.dashboard = this;
    /*
     * extend the input object with all the component methods,
     * and endow it with the Backbone event system.
     */
    _.extend(object,objectImpl,Backbone.Events);
  }
};


Dashboards.restoreDuplicates = function() {
  /*
   * We mark duplicates by appending an _nn suffix to their names.
   * This means that, when we read the parameters from bookmarks,
   * we can look for the _nn suffixes, and infer from those suffixes
   * what duplications were triggered, allowing us to reproduce that
   * state as well.
   */
  var dupes = this.components.filter(function(c){return c.type == 'duplicate'}),
      suffixes = {},
      params = this.getBookmarkState().params || {};
  /*
   * First step is to go over the bookmarked parameters and find
   * all of those that end with the _nn suffix (possibly several
   * such suffixes piled up, like _1_2, as we can re-duplicate
   * existing duplicates).
   * 
   * The suffixes object then maps those suffixes to a mapping of
   * the root parameter names to their respective values.
   * E.g. a parameter 'foo_1 = 1' yields '{_1: {foo: 1}}'
   */
  Object.keys(params).filter(function(e){
      return /(_[0-9]+)+$/.test(e);
  }).map(function(e){
      var parts = e.match(/(.*?)((_[0-9]+)+)$/),
          name = parts[1],
          suffix = parts[2];
      if(!suffixes[suffix]){
          suffixes[suffix] = {}
      }
      suffixes[suffix][name] = params[e];
      return e;
  });


  /*
   * Once we have the suffix list, we'll check each suffix's 
   * parameter list against each of the DuplicateComponents
   * in the dashboard. We consider that a suffix matches a
   * DuplicateComponent if the suffix contains all of the
   * Component's Bookmarkable parameters. If we're satisfied
   * that such a match was found, then we tell the Component
   * to trigger a duplication with the provided values.
   */
  var myself = this;
  for (var s in suffixes) if (suffixes.hasOwnProperty(s)) {
    var params = suffixes[s];
    $.each(dupes,function(i,e){
      var p;
      for (p = 0; p < e.parameters.length;p++) {
        if (!params.hasOwnProperty(e.parameters[p]) && myself.isBookmarkable(e.parameters[p])) {
          return;
        }
      }
      e.duplicate(params);
    });
  }
}
Dashboards.blockUIwithDrag = function() {
  if (typeof this.i18nSupport !== "undefined" && this.i18nSupport != null) {
    // If i18n support is enabled process the message accordingly
    $.blockUI.defaults.message = '<div style="padding: 0px;"><img src="' + webAppPath + '/content/pentaho-cdf/resources/style/images/processing_transparent.gif" /></div>';
  }

  $.blockUI();
  var handle = $('<div id="blockUIDragHandle"></div>')
  $("div.blockUI.blockMsg").prepend(handle);
  $("div.blockUI.blockMsg").draggable({
    handle: "#blockUIDragHandle"
  });
};

Dashboards.updateLifecycle = function(object) {
  var silent = object.lifecycle ? !!object.lifecycle.silent : false;

    if( object.disabled ){
      return;
    }
    if(!silent) {
      this.incrementRunningCalls();
    }
    var handler = _.bind(function() {
      try {
        var shouldExecute;
        if(!(typeof(object.preExecution)=='undefined')){
          var shouldExecute = object.preExecution.apply(object);
        }
        /*
         * If `preExecution` returns anything, we should use its truth value to
         * determine whether the component should execute. If it doesn't return
         * anything (or returns `undefined`), then by default the component
         * should update.
         */
        shouldExecute = typeof shouldExecute != "undefined"? !!shouldExecute : true;
        object.trigger('cdf cdf:preExecution', object, shouldExecute);
        if (!shouldExecute) {
          return; // if preExecution returns false, we'll skip the update
        }
        if (object.tooltip != undefined){
          object._tooltip = typeof object["tooltip"]=='function'?object.tooltip():object.tooltip;
        }
        // first see if there is an objectImpl
        if ((object.update != undefined) &&
          (typeof object['update'] == 'function')) {
          object.update();

          // check if component has periodic refresh and schedule next update
          this.refreshEngine.processComponent(object);

        } else {
        // unsupported update call
        }

        object.trigger('cdf cdf:postExecution', object);
        if(!(typeof(object.postExecution)=='undefined')){
          object.postExecution.apply(object);
        }
        // if we have a tooltip component, how is the time.
        if (object._tooltip != undefined){
          $("#" + object.htmlObject).attr("title",object._tooltip).tooltip({
            delay:0,
            track: true,
            fade: 250
          });
        }
      } catch (e) {
        this.log("Error updating " + object.name +":",'error');
        this.log(e,'exception');
      } finally {
        if(!silent) {
          this.decrementRunningCalls();
        }
      }
  },this);
  setTimeout(handler,1);
};

Dashboards.update = function(component) {
  this.updateAll([component]);
};

Dashboards.updateComponent = function(object) {
  if(object.isManaged === false && object.update) {
    object.update();
  } else {
    this.updateLifecycle(object);
  }
};

Dashboards.createAndCleanErrorDiv = function(){
  if ($("#"+CDF_ERROR_DIV).length == 0){
    $("body").append("<div id='" +  CDF_ERROR_DIV + "'></div>");
  }
  $("#"+CDF_ERROR_DIV).empty();
};

Dashboards.showErrorTooltip = function(){
  $(function(){
    $(".cdf_error").tooltip({
      delay:0,
      track: true,
      fade: 250,
      showBody: " -- "
    })
  });
};

Dashboards.getComponent = function(name){
  for (i in this.components){
    if (this.components[i].name == name)
      return this.components[i];
  }
};

Dashboards.getComponentByName = function(name) {
  if (this.globalContext) {
    return eval(name);
  } else {
    return this.getComponent(name);
  }
};

Dashboards.addComponents = function(components) {
  // attempt to convert over to component implementation
  for (var i =0; i < components.length; i++) {
    this.bindControl(components[i]);
  }
  this.components = this.components.concat(components);
};

Dashboards.registerEvent = function (ev, callback) {
  if (typeof this.events == 'undefined') {
    this.events = {};
  }
  this.events[ev] = callback;
};

Dashboards.addArgs = function(url){
  if(url != undefined)
    this.args = getURLParameters(url);
};

Dashboards.setI18nSupport = function(lc, i18nRef) {
  // Update global reference to i18n objects if needed
  if (i18nRef !== "undefined" && lc !== "undefined") {
    this.i18nCurrentLanguageCode = lc;
    this.i18nSupport = i18nRef;
  }

};

Dashboards.init = function(components){
  var myself =this;
  if(this.initialStorage) {
    _.extend(this.storage, this.initialStorage);
  } else {
    this.loadStorage();
  }
  this.restoreBookmarkables();
  this.restoreView();
  this.syncParametersInit();
  if ($.isArray(components)) {
    this.addComponents(components);
  }
  $(function() {
    myself.initEngine();
  });
};


/* Keep parameters master and slave in sync. The master parameter's
 * initial value takes precedence over the slave parameter's when
 * initializing the dashboard.
 */
Dashboards.syncParameters = function(master, slave) {
  this.setParameter(slave, this.getParameterValue(master));
  this.parameterModel.change();
  this.parameterModel.on("change:" + master,function(m,v){this.fireChange(slave,v)},this);
  this.parameterModel.on("change:" + slave,function(m,v){this.fireChange(master,v)},this);
}

Dashboards.chains = [];
Dashboards.syncedParameters = {};
/* Register parameter pairs that will be synced on dashboard init. We'll store
 * the dependency pairings in Dashboards.syncedParameters,as an object mapping
 * master parameters to an array of all its slaves (so {a: [b,c]} means that
 * both *b* and *c* are subordinate to *a*), and in Dashboards.chains wel'll
 * store an array of arrays representing a list of separate dependency trees.
 * An entry of the form [a, b, c] means that *a* doesn't depend on either *b*
 * or *c*, and that *b* doesn't depend on *c*. Inversely, *b* depends on *a*,
 * and *c* depends on either *a* or *b*. You can have multiple such entries,
 * each representing a completely isolated set of dependencies.
 *
 * Note that we make no effort to detect circular dependencies. Behaviour is
 * undetermined should you provide such a case.
 */
Dashboards.syncParametersOnInit = function (master, slave){
  var parameters = this.syncedParameters,
      currChain,
      masterChain,
      slaveChain, slaveChainIdx, i;
  if(!parameters[master]) parameters[master] = [];
  parameters[master].push(slave);
  
  /* When inserting an entry into Dashboards.chains, we need to check whether
   * any of the master or the slave are already in one of the chains.
   */
  for (i = 0; i < this.chains.length;i++) {
    currChain = this.chains[i];
    if (currChain.indexOf(master) > -1) {
      masterChain = currChain;
    }
    if (currChain.indexOf(slave) > -1) {
      slaveChain = currChain;
      slaveChainIdx = i;
    }    
  }
  /* If both slave and master are present in different chains, we merge the
   * chains.
   *
   * If only one of the two is present, we insert the slave at the end
   * of the master's chain, or the master at the head of the slave's chain.
   * 
   * Note that, since a parameter can be both a master and a slave, and because
   * no slave can have two masters, it is guaranteed that we can only add the
   * master to the head of the chain if the slave was the head before, and, when
   * adding the slave at the end of the master's chain, none of the parameters
   * between master and slave can depend on the slave. This means there is no
   * scenario where a chain can become inconsistent from prepending masters or
   * appending slaves.
   *
   * If neither master nor slave is present in the existing chains, we create a
   * new chain with [master, slave].
   */
  if(slaveChain && masterChain) {
    if (masterChain != slaveChain) {
      args = slaveChain.slice();
      args.unshift(0);
      args.unshift(masterChain.length);
      [].splice.apply(masterChain,args);
      this.chains.splice(slaveChainIdx,1);
    }
  } else if (slaveChain) {
      slaveChain.unshift(master);
  } else if(masterChain) {
      masterChain.push(slave)
  } else {
    this.chains.push([master, slave]);
  }
}

/*
 * Iterate over the registered parameter syncing chains,
 * and configure syncing for each parameter pair.
 */
Dashboards.syncParametersInit = function() {
  var parameters = this.syncedParameters,
      i,j,k,master, slave;
  for(i = 0; i < this.chains.length;i++) {
    for(j = 0; j < this.chains[i].length;j++) {
      var master = this.chains[i][j];
      if(!parameters[master]) continue;
      for(k = 0; k < parameters[master].length; k++) {
        slave = parameters[master][k];
        this.syncParameters(master,slave);
      }
    }
  }
}


Dashboards.initEngine = function(){
  var myself = this;
  var components = this.components;
  this.incrementRunningCalls();
  this.createAndCleanErrorDiv();
  // Fire all pre-initialization events
  if(typeof this.preInit == 'function') {
    this.preInit();
  }
  this.trigger("cdf cdf:preInit",this);
  /* Legacy Event -- don't rely on this! */
  $(window).trigger('cdfAboutToLoad');
  var myself = this;
  var updating = [],i;
  for(i = 0; i < components.length;i++) {
    if(components[i].executeAtStart) {
      updating.push(components[i]);
    }
  }

  if (!updating.length) {
    this.handlePostInit();
    return;
  }
  this.waitingForInit = updating.slice();

  var callback = function(comp,isExecuting) {
    /*
     * The `preExecution` event will pass two arguments (the component proper
     * and a flag telling us whether the preExecution test passed), so we can
     * test for that, and check whether the component is executing or not.
     * If it's not going to execute, we should check for postInit right now.
     * If it is, we shouldn't do anything.right now.
     */
    if(arguments.length == 2 && isExecuting) {
      return;
    }
    this.waitingForInit = _(this.waitingForInit).without(comp);
    comp.off('cdf:postExecution',callback);
    comp.off('cdf:preExecution',callback);
    this.handlePostInit();
  }

  setTimeout(
    function() {
      for(var i= 0, len = updating.length; i < len; i++){
        var component = updating[i];
        component.on('cdf:postExecution cdf:preExecution',callback,myself);
      }
      Dashboards.updateAll(updating);
      if(components.length > 0) {
        myself.handlePostInit();
      }
    },
    this.renderDelay
  );
};

Dashboards.handlePostInit = function() {
  if(!this.waitingForInit || this.waitingForInit.length === 0) {
    this.trigger("cdf cdf:postInit",this);
    /* Legacy Event -- don't rely on this! */
    $(window).trigger('cdfLoaded');

    if(typeof this.postInit == "function") {
      this.postInit();
    }
    this.restoreDuplicates();
    this.finishedInit = true;
    this.decrementRunningCalls();
  }
};

Dashboards.resetAll = function(){
  this.createAndCleanErrorDiv();
  var compCount = this.components.length;
  for(var i= 0, len = this.components.length; i < len; i++){
    this.components[i].clear();
  }
  var compCount = this.components.length;
  for(var i= 0, len = this.components.length; i < len; i++){
    if(this.components[i].executeAtStart){
      this.update(this.components[i]);
    }
  }
};

Dashboards.processChange = function(object_name){
  var object = this.getComponentByName(object_name);
  var parameter = object.parameter;
  var value;
  if (typeof object['getValue'] == 'function') {
    value = object.getValue();
  }
  if (value == null) // We won't process changes on null values
    return;

  if(!(typeof(object.preChange)=='undefined')){
    var preChangeResult = object.preChange(value);
    value = preChangeResult != undefined ? preChangeResult : value;
  }
  if(parameter) {
    this.fireChange(parameter,value);
  }
  if(!(typeof(object.postChange)=='undefined')){
    object.postChange(value);
  }
};

/* fireChange must accomplish two things:
 * first, we must change the parameters
 * second, we execute the components that listen for
 * changes on that parameter.
 *
 * Because some browsers won't draw the blockUI widgets
 * until the script has finished, we find the list of
 * components to update, then execute the actual update
 * in a function wrapped in a setTimeout, so the running
 * script has the opportunity to finish.
 */
Dashboards.fireChange = function(parameter, value) {
  var myself = this;
  this.createAndCleanErrorDiv();

  this.setParameter(parameter, value);
  this.parameterModel.change();
  var toUpdate = [];
  var workDone = false;
  for (var i= 0, len = this.components.length; i < len; i++){
    if ($.isArray(this.components[i].listeners)){
      for (var j= 0 ; j < this.components[i].listeners.length; j++){
        var comp = this.components[i];
        if (comp.listeners[j] == parameter && !comp.disabled) {
          toUpdate.push(comp);
          break;
        }
      }
    }
  }
  setTimeout(function() {
    for (var i = 0; i < toUpdate.length; i++) {
      myself.update(toUpdate[i]);
    }
  }, this.renderDelay);
};


/* Update components by priority. Expects as parameter an object where the keys
 * are the priorities, and the values are arrays of components that should be
 * updated at that priority level:
 *
 *  {
 *    0: [c1,c2],
 *    2: [c3],
 *    10: [c4]
 *  }
 *
 *  Note that even though it expects numerical keys, 
 */
Dashboards.updateAll = function(components) {
  if(!this.updating) {
    this.updating = {
      tiers: {},
      current: null
    };
  }
  if(components && _.isArray(components) && !_.isArray(components[0])) {
    var comps = [];
    _.each(components,function(c) {
      var prio = c.priority || 0;
      if(!comps[prio]) {
        comps[prio] = [];
      }
      comps[prio].push(c);
    });
    components = comps;
  }
  this.mergePriorityLists(this.updating.tiers,components);

  var updating = this.updating.current;
  if(updating === null || updating.components.length == 0) {
    var toUpdate = this.getFirstTier(this.updating.tiers);
    if(!toUpdate) return;
    this.updating.current = toUpdate;

    var postExec = function(component,isExecuting) {
      /*
       * The `preExecution` event will pass two arguments (the component proper
       * and a flag telling us whether the preExecution test passed), so we can
       * test for that, and check whether the component is executing or not.
       * If it's not going to execute, we should queue up the next component
       * right now. If it is, we shouldn't do anything.right now.
       */
      if(arguments.length == 2 && isExecuting) {
        return;
      }
      component.off("cdf:postExecution",postExec);
      component.off("cdf:preExecution",postExec);
      var current = this.updating.current;
      current.components = _.without(current.components, component);
      var tiers = this.updating.tiers;
      tiers[current.priority] = _.without(tiers[current.priority], component);
      this.updateAll();
    }
    /*
     * We need a copy of `this.updating.current.components` here so that we can
     * update them all without having items removed from the list by calls to
     * `postExec` made by synchronous components.
     */
    var comps = this.updating.current.components.slice();
    for(var i = 0; i < comps.length;i++) {
      component = comps[i];
      component.on("cdf:postExecution cdf:preExecution",postExec,this);
      this.updateComponent(component);
    }
  }
}

/*
 * Given a list of component priority tiers, returns the highest priority
 * non-empty tier of components awaiting update, or null if no such tier exists.
 */
Dashboards.getFirstTier = function(tiers) {
      var keys = _.keys(tiers).sort(function(a,b){
        return parseInt(a,10) - parseInt(b,10);
      }),
      i, tier;

  for(i = 0;i < keys.length;i++) {
    tier = tiers[keys[i]];
    if(tier.length > 0) {
      return {priority: keys[i], components: tier.slice()};
    }
  }
  return null;
}

/*
 * Add all components in priority list 'source' into priority list 'target'
 */
Dashboards.mergePriorityLists = function(target,source) {
  if(!source) {
    return;
  }
  for(key in source) if (source.hasOwnProperty(key)) {
    if(_.isArray(target[key])) {
      target[key] = _.union(target[key],source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

Dashboards.restoreView = function() {
  var p, params;
  if(!this.view) return;
  /* Because we're storing the parameters in OrientDB, and as OrientDB has some
   * serious issues when storing nested objects, we're stuck marshalling the
   * parameters into a JSON object and converting that JSON into a Base64 blob
   * before storage. So now we have to decode that mess.
   */
  params = JSON.parse(Base64.decode(this.view.params));
  for(p in params) if (params.hasOwnProperty(p)) {
    this.setParameter(p,params[p]);
  }
};

Dashboards.getHashValue = function(key) {
  var hash = window.location.hash,
      obj;
  try {
    obj = JSON.parse(hash.slice(1));
  } catch (e) {
    obj = {};
  }
  if (arguments.length === 0) {
    return obj;
  } else {
    return obj[key];
  }
}

Dashboards.setHashValue = function(key, value) {
  var obj = this.getHashValue(),json;
  if (arguments.length == 1) {
    obj = key;
  } else {
    obj[key] = value;
  }
  json = JSON.stringify(obj);
  /* We don't want to store empty objects */
  if (json != "{}") {
    window.location.hash = json;
  } else {
    if (window.location.hash) {
      window.location.hash = '';
    }
  }
}
Dashboards.deleteHashValue = function(key) {
  var obj = this.getHashValue();
  if (arguments.length === 0) {
    window.location.hash = "";
  } else {
    delete obj[key];
    this.setHashValue(obj);
  }
}
Dashboards.setBookmarkable = function(parameter, value) {
    if(!this.bookmarkables) this.bookmarkables = {};
    if (arguments.length === 1) value = true;
    this.bookmarkables[parameter] = value;
};

Dashboards.isBookmarkable = function(parameter) {
    if(!this.bookmarkables) {return false;}
    return Boolean(this.bookmarkables[parameter]);
};



Dashboards.generateBookmarkState = function() {
  var params = {}
      bookmarkables = this.bookmarkables;
  for (k in bookmarkables) if (bookmarkables.hasOwnProperty(k)) {
    if (bookmarkables[k]) {
      params[k] = this.getParameterValue(k);
    }
  }
  return params;
};

Dashboards.persistBookmarkables = function(param) {
  var bookmarkables = this.bookmarkables,
      params = {},
      state;
  /*
   * We don't want to update the hash if we were passed a
   * non-bookmarkable parameter (why bother?), nor is there
   * much of a point in publishing changes when we're still
   * initializing the dashboard. That's just the code for
   * restoreBookmarkables doing the reverse of this!
   */
  if (!bookmarkables || !bookmarkables[param]) {
    return;
  }
  if(!this.finishedInit) {
    return;
  }
  params = this.generateBookmarkState();
  this.setBookmarkState({impl: 'client',params: params});
}

Dashboards.setBookmarkState = function(state) {
  if(window.history && window.history.replaceState) {
    var method = window.location.pathname.split('/').pop(),
        query = window.location.search.slice(1).split('&').map(function(e){
          var entry = e.split('=');
          entry[1] = decodeURIComponent(entry[1]);
          return entry;
        }),
        url;
    query = this.propertiesArrayToObject(query);
    query.bookmarkState = JSON.stringify(state);
    url = method + '?' + $.param(query);
    window.history.replaceState({},'',url);
    this.deleteHashValue('bookmark')
  } else {
    this.setHashValue('bookmark',state);
  }
};

Dashboards.getBookmarkState = function() {
  /*
   * browsers that don't support history.pushState
   * can't actually safely remove bookmarkState param,
   * so we must first check whether there is a hash-based
   * bookmark state.
   */
  if (window.location.hash.length > 1) {
  try {
      return this.getHashValue('bookmark') || {};
    } catch (e) {
      /*
       * We'll land here if the hash isn't a valid json object,
       * so we'll go on and try getting the state from the params
       */
    }
  }
  var query = window.location.search.slice(1).split('&').map(function(e){
          var pair = e.split('=');
          pair[1] = decodeURIComponent(pair[1]);
          return pair;
      }),
      params = this.propertiesArrayToObject(query),
      bookmarkState;
  if(params.bookmarkState) {
    return JSON.parse(decodeURIComponent(params.bookmarkState.replace(/\+/g,' '))) || {};
  } else  {
    return {};
  }
};

Dashboards.restoreBookmarkables = function() {
  var state;
  this.bookmarkables = this.bookmarkables || {};
  try {
    state = this.getBookmarkState().params;
    for (k in state) if (state.hasOwnProperty(k)) {
      this.setParameter(k,state[k]);
    }
  } catch (e) {
    this.log(e,'error');
  }
}

Dashboards.setParameterViewMode = function(parameter, value) {
    if(!this.viewParameters) this.viewParameters = {};
    if (arguments.length === 1) value = this.viewFlags.VIEW;
    //if(!Dashboards.viewFlags.hasOwnProperty(value)) throw 
    this.viewParameters[parameter] = value;
};

Dashboards.isViewParameter = function(parameter) {
    if(!this.viewParameters) {return false;}
    return this.viewParameters[parameter];
};

/*
 * List the values for all dashboard parameters flagged as being View parameters
 */
Dashboards.getViewParameters = function(){
  if(!this.viewParameters) return {};
  var params = this.viewParameters,
      ret = {};
  for(p in params) if (params.hasOwnProperty(p)) {
    if (params[p] == this.viewFlags.VIEW|| params[p] == this.viewFlags.UNBOUND) {
      ret[p] = this.getParameterValue(p);
    }
  }
  return ret;
};

/*
 * List all dashboard parameters flagged as being Unbound View parameters
 */

Dashboards.getUnboundParameters = function(){
  if(!this.viewParameters) return [];
  var params = this.viewParameters,
      ret = []
  for(p in params) if (params.hasOwnProperty(p)) {
    if (params[p] == this.viewFlags.UNBOUND) {
      ret.push(p);
    }
    return ret;
  }
};

Dashboards.getParameterValue = function (parameterName) {
  if (this.globalContext) {
    try{
      return eval(parameterName);
    }
    catch (e){
      this.error(e);
      return undefined;
    }
  } else {
    return this.parameters[parameterName];
  }
};

Dashboards.getQueryParameter = function ( parameterName ) {
  // Add "=" to the parameter name (i.e. parameterName=value)
  var queryString = window.location.search.substring(1);
  var parameterName = parameterName + "=";
  if ( queryString.length > 0 ) {
    // Find the beginning of the string
    begin = queryString.indexOf ( parameterName );
    // If the parameter name is not found, skip it, otherwise return the value
    if ( begin != -1 ) {
      // Add the length (integer) to the beginning
      begin += parameterName.length;
      // Multiple parameters are separated by the "&" sign
      end = queryString.indexOf ( "&" , begin );
      if ( end == -1 ) {
        end = queryString.length
      }
      // Return the string
      return decodeURIComponent ( queryString.substring ( begin, end ) );
    }
    // Return "" if no parameter has been found
    return "";
  }
};

Dashboards.setParameter = function(parameterName, parameterValue) {
  if(parameterName == undefined || parameterName == "undefined"){
    this.log('Dashboards.setParameter: trying to set undefined!!','warn');
    return;  
  }
  if (this.globalContext) {
    //ToDo: this should really be sanitized!
    eval( parameterName + " = " + JSON.stringify(parameterValue) );
  } else {
    if(this.escapeParameterValues) {
      this.parameters[parameterName] = encode_prepare_arr(parameterValue);
    } else {
      this.parameters[parameterName] = parameterValue;
    }
  }
  this.parameterModel.set(parameterName,parameterValue,{silent:true});
  this.persistBookmarkables(parameterName);
};


Dashboards.post = function(url,obj){

  var form = '<form action="' + url + '" method="post">';
  for(o in obj){

    var v = (typeof obj[o] == 'function' ? obj[o]() : obj[o]);

    if (typeof v == 'string') {
      v = v.replace(/"/g , "\'")
    }

    form += '"<input type="hidden" name="' + o + '" value="' + v + '"/>';
  }
  form += '</form>';
  jQuery(form).appendTo('body').submit().remove();
};

Dashboards.clone = function clone(obj) {

  var c = obj instanceof Array ? [] : {};

  for (var i in obj) {
    var prop = obj[i];

    if (typeof prop == 'object') {
      if (prop instanceof Array) {
        c[i] = [];

        for (var j = 0; j < prop.length; j++) {
          if (typeof prop[j] != 'object') {
            c[i].push(prop[j]);
          } else {
            c[i].push(this.clone(prop[j]));
          }
        }
      } else {
        c[i] = this.clone(prop);
      }
    } else {
      c[i] = prop;
    }
  }

  return c;
};

Dashboards.getArgValue  = function(key)
{
  for (i=0;i<this.args.length;i++){
    if(this.args[i][0] == key){
      return this.args[i][1];
    }
  }

  return undefined;
};

Dashboards.ev = function(o){
  return typeof o == 'function'?o():o
};

Dashboards.callPentahoAction = function(obj, solution, path, action, parameters, callback ){
  myself = this;
  // Encapsulate pentahoAction call
  // Dashboards.log("Calling pentahoAction for " + obj.type + " " + obj.name + "; Is it visible?: " + obj.visible);
  if(typeof callback == 'function'){
    return this.pentahoAction( solution, path, action, parameters,
      function(json){
        callback(myself.parseXActionResult(obj,json));
      }
      );
  }
  else{
    return this.parseXActionResult(obj,this.pentahoAction( solution, path, action, parameters, callback ));
  }
};

Dashboards.urlAction = function ( url, params, func) {
  return this.executeAjax('xml', url, params, func);
};

Dashboards.executeAjax = function( returnType, url, params, func ) {
  var myself = this;
  // execute a url
  if (typeof func == "function"){
    // async
    return $.ajax({
      url: url,
      type: "POST",
      dataType: returnType,
      async: true,
      data: params,
      complete: function (XMLHttpRequest, textStatus) {
        func(XMLHttpRequest.responseXML);
      },
      error: function (XMLHttpRequest, textStatus, errorThrown) {
        this.log("Found error: " + XMLHttpRequest + " - " + textStatus + ", Error: " +  errorThrown,"error");
      }

    }
    );
  }
	
  // Sync
  var result = $.ajax({
    url: url,
    type: "POST",
    dataType:returnType,
    async: false,
    data: params,
    error: function (XMLHttpRequest, textStatus, errorThrown) {
      myself.log("Found error: " + XMLHttpRequest + " - " + textStatus + ", Error: " +  errorThrown,"error");
    }

  });
  if (returnType == 'xml') {
    return result.responseXML;
  } else {
    return result.responseText;
  }

}; 

Dashboards.pentahoAction = function( solution, path, action, params, func ) {
  return this.pentahoServiceAction('ServiceAction', 'xml', solution, path, action, params, func);
};

Dashboards.pentahoServiceAction = function( serviceMethod, returntype, solution, path, action, params, func ) {
  // execute an Action Sequence on the server

  var url = webAppPath + "/" + serviceMethod;

  // Add the solution to the params
  var arr = {};
  arr.wrapper = false;
  arr.solution = solution;
  arr.path = path;
  arr.action = action;
  $.each(params,function(i,val){
    arr[val[0]]=val[1];
  });
  return this.executeAjax(returntype, url, arr, func);
};

Dashboards.parseXActionResult = function(obj,html){

  var jXML = $(html);
  var error = jXML.find("SOAP-ENV\\:Fault");
  if (error.length == 0){
    return jXML;
  }

  // error found. Parsing it
  var errorMessage = "Error executing component " + obj.name;
  var errorDetails = new Array();
  errorDetails[0] = " Error details for component execution " + obj.name + " -- ";
  errorDetails[1] = error.find("SOAP-ENV\\:faultstring").find("SOAP-ENV\\:Text:eq(0)").text();
  error.find("SOAP-ENV\\:Detail").find("message").each(function(){
    errorDetails.push($(this).text())
  });
  if (errorDetails.length > 8){
    errorDetails = errorDetails.slice(0,7);
    errorDetails.push("...");
  }

  var out = "<table class='errorMessageTable' border='0'><tr><td><img src='"+ ERROR_IMAGE + "'></td><td><span class=\"cdf_error\" title=\" " + errorDetails.join('<br/>').replace(/"/g,"'") +"\" >" + errorMessage + " </span></td></tr></table/>";

  // if this is a hidden component, we'll place this in the error div
  if (obj.visible == false){
    $("#"+CDF_ERROR_DIV).append("<br />" + out);
  }
  else{
    $('#'+obj.htmlObject).html(out);
  }


  return null;

};

Dashboards.setSettingsValue = function(name,object){

  var data = {
    method: "set",
    key: name,
    value: JSON.stringify(object)
  };
  $.post("Settings", data, function(){});
};

Dashboards.getSettingsValue = function(key,value){

  var callback = typeof value == 'function' ? value : function(json){
    value = json;
  };
	
  $.getJSON("Settings?method=get&key=" + key , callback);
};

Dashboards.fetchData = function(cd, params, callback) {
  this.log('Dashboards.fetchData() is deprecated. Use Query objects instead','warn');
  // Detect and handle CDA data sources
  if (cd != undefined && cd.dataAccessId != undefined) {
    for (param in params) {
      cd['param' + params[param][0]] = this.getParameterValue(params[param][1]);
    }
    $.post(webAppPath + "/content/cda/doQuery?", cd,
      function(json) {
        callback(json);
      },'json');
  }
  // When we're not working with a CDA data source, we default to using jtable to fetch the data...
  else if (cd != undefined){
	
    var xactionFile = (cd.queryType == 'cda')? "jtable-cda.xaction" : "jtable.xaction";
  
    $.post(webAppPath + "/ViewAction?solution=system&path=pentaho-cdf/actions&action=" + xactionFile, cd,
      function(result) {
        callback(result.values); 
      },'json');
  }
  // ... or just call the callback when no valid definition is passed
  else {
    callback([]);
  }
};

Dashboards.escapeHtml = function(input) {
  var escaped = input
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/'/g,"&#39;")
  .replace(/"/g,"&#34;");
  return escaped;
};
// STORAGE ENGINE

// Default object
Dashboards.storage = {};

// Operations
Dashboards.loadStorage = function(){
  var myself = this;
  // Don't do anything for anonymousUser.
  if( this.context && this.context.user === "anonymousUser") {
    return;
  }

  var args = {
    action: "read",
    _: (new Date()).getTime() // Needed so IE doesn't try to be clever and retrieve the response from cache
  };
  $.getJSON(webAppPath + "/content/pentaho-cdf/Storage", args, function(json) {
    $.extend(myself.storage,json);
  });
};

Dashboards.saveStorage = function(){
  var myself = this;
  // Don't do anything for anonymousUser
  if( this.context && this.context.user === "anonymousUser") {
    return;
  }

  var args = {
    action: "store",
    storageValue: JSON.stringify(this.storage),
    _: (new Date()).getTime() // Needed so IE doesn't try to be clever and retrieve the response from cache
  };
  $.getJSON(webAppPath + "/content/pentaho-cdf/Storage", args, function(json) {
    if(json.result != true){
      myself.log("Error saving storage",'error');
    }
  });
};

Dashboards.cleanStorage = function(){
  var myself = this;
  this.storage = {};

  // Don't do noting for anonymousUser
  if( this.context && this.context.user === "anonymousUser") {
    return;
  }
  
  var args = {
    action: "delete"
  };
  $.getJSON(webAppPath + "/content/pentaho-cdf/Storage", args, function(json) {
    if(json.result != true){
      myself.log("Error deleting storage", 'error');
    }
  });
};

Dashboards.propertiesArrayToObject = function(pArray) {
  var obj = {};
  for (p in pArray) if (pArray.hasOwnProperty(p)) {
    var prop = pArray[p];
    obj[prop[0]] = prop[1];
  }
  return obj;
}

Dashboards.objectToPropertiesArray = function(obj) {
  var pArray = [];
  for (key in obj) if (obj.hasOwnProperty(key)) {
    pArray.push([key,obj[key]]);
  }
  return pArray;
}

/**
 *
 * UTF-8 data encode / decode
 * http://www.webtoolkit.info/
 *
 *
 **/
function encode_prepare_arr(value) {
  if(typeof value == "number"){
    return value;
  } else if ($.isArray(value)){
    var a = new Array(value.length);
    $.each(value,function(i,val){
      a[i] = encode_prepare(val);
    });
    return a;
  }
  else{
    return encode_prepare(value);
  }
};

function encode_prepare( s )
{
  if (s != null) {
    s = s.replace(/\+/g," ");
    if ($.browser == "msie" || $.browser == "opera"){
      return Utf8.decode(s);
    }
  }
  return s;
};

var Utf8 = {

  // public method for url encoding
  encode : function (string) {
    string = string.replace(/\r\n/g,"\n");
    var utftext = "";

    for (var n = 0; n < string.length; n++) {

      var c = string.charCodeAt(n);

      if (c < 128) {
        utftext += String.fromCharCode(c);
      }
      else if((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      }
      else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }

    }

    return utftext;
  },

  // public method for url decoding
  decode : function (utftext) {
    var string = "";
    var i = 0;
    var c = c1 = c2 = 0;

    while ( i < utftext.length ) {

      c = utftext.charCodeAt(i);

      if (c < 128) {
        string += String.fromCharCode(c);
        i++;
      }
      else if((c > 191) && (c < 224)) {
        c2 = utftext.charCodeAt(i+1);
        string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
        i += 2;
      }
      else {
        c2 = utftext.charCodeAt(i+1);
        c3 = utftext.charCodeAt(i+2);
        string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
        i += 3;
      }

    }

    return string;
  }

}

function getURLParameters(sURL) 
{
  if (sURL.indexOf("?") > 0){

    var arrParams = sURL.split("?");
    var arrURLParams = arrParams[1].split("&");
    var arrParam = [];

    for (i=0;i<arrURLParams.length;i++){
      var sParam =  arrURLParams[i].split("=");

      if (sParam[0].indexOf("param",0) == 0){
        var parameter = [sParam[0].substring(5,sParam[0].length),unescape(sParam[1])];
        arrParam.push(parameter);
      }
    }

  }

  return arrParam;
};

function toFormatedString(value) {
  value += '';
  x = value.split('.');
  x1 = x[0];
  x2 = x.length > 1 ? '.' + x[1] : '';
  var rgx = /(\d+)(\d{3})/;
  while (rgx.test(x1))
    x1 = x1.replace(rgx, '$1' + ',' + '$2');
  return x1 + x2;
};

//quote csv values in a way compatible with CSVTokenizer
function doCsvQuoting(value, separator, alwaysEscape){
  var QUOTE_CHAR = '"';
  if(separator == null) {
    return value;
  }
  if(value == null) {
    return null;
  }
  if(value.indexOf(QUOTE_CHAR) >= 0){
    //double them
    value = value.replace(QUOTE_CHAR, QUOTE_CHAR.concat(QUOTE_CHAR));
  }
  if(alwaysEscape || value.indexOf(separator) >= 0){
    //quote value
    value =  QUOTE_CHAR.concat(value, QUOTE_CHAR);
  }
  return value;
};

/**
*
*  Javascript sprintf
*  http://www.webtoolkit.info/
*
*
**/
sprintfWrapper = {

  init : function () {

    if (typeof arguments == 'undefined') {
      return null;
    }
    if (arguments.length < 1) {
      return null;
    }
    if (typeof arguments[0] != 'string') {
      return null;
    }
    if (typeof RegExp == 'undefined') {
      return null;
    }

    var string = arguments[0];
    var exp = new RegExp(/(%([%]|(\-)?(\+|\x20)?(0)?(\d+)?(\.(\d)?)?([bcdfosxX])))/g);
    var matches = new Array();
    var strings = new Array();
    var convCount = 0;
    var stringPosStart = 0;
    var stringPosEnd = 0;
    var matchPosEnd = 0;
    var newString = '';
    var match = null;

    while (match = exp.exec(string)) {
      if (match[9]) {
        convCount += 1;
      }

      stringPosStart = matchPosEnd;
      stringPosEnd = exp.lastIndex - match[0].length;
      strings[strings.length] = string.substring(stringPosStart, stringPosEnd);

      matchPosEnd = exp.lastIndex;
      
      var negative = parseInt(arguments[convCount]) < 0 ? true : false;
      if(negative == 0) negative = parseFloat(arguments[convCount]) < 0 ? true : false;
      
      matches[matches.length] = {
        match: match[0],
        left: match[3] ? true : false,
        sign: match[4] || '',
        pad: match[5] || ' ',
        min: match[6] || 0,
        precision: match[8],
        code: match[9] || '%',
        negative: negative,
        argument: String(arguments[convCount])
      };
    }
    strings[strings.length] = string.substring(matchPosEnd);

    if (matches.length == 0) {
      return string;
    }
    if ((arguments.length - 1) < convCount) {
      return null;
    }

    var code = null;
    var match = null;
    var i = null;

    for (i=0; i<matches.length; i++) {
      var m =matches[i];

      if (m.code == '%') {
        substitution = '%'
      }
      else if (m.code == 'b') {
        m.argument = String(Math.abs(parseInt(m.argument)).toString(2));
        substitution = sprintfWrapper.convert(m, true);
      }
      else if (m.code == 'c') {
        m.argument = String(String.fromCharCode(parseInt(Math.abs(parseInt(m.argument)))));
        substitution = sprintfWrapper.convert(m, true);
      }
      else if (m.code == 'd') {
        m.argument = toFormatedString(String(Math.abs(parseInt(m.argument))));
        substitution = sprintfWrapper.convert(m);
      }
      else if (m.code == 'f') {
        m.argument = toFormatedString(String(Math.abs(parseFloat(m.argument)).toFixed(m.precision ? m.precision : 6)));
        substitution = sprintfWrapper.convert(m);
      }
      else if (m.code == 'o') {
        m.argument = String(Math.abs(parseInt(m.argument)).toString(8));
        substitution = sprintfWrapper.convert(m);
      }
      else if (m.code == 's') {
        m.argument = m.argument.substring(0, m.precision ? m.precision : m.argument.length)
        substitution = sprintfWrapper.convert(m, true);
      }
      else if (m.code == 'x') {
        m.argument = String(Math.abs(parseInt(m.argument)).toString(16));
        substitution = sprintfWrapper.convert(m);
      }
      else if (m.code == 'X') {
        m.argument = String(Math.abs(parseInt(m.argument)).toString(16));
        substitution = sprintfWrapper.convert(m).toUpperCase();
      }
      else {
        substitution = m.match;
      }

      newString += strings[i];
      newString += substitution;

    }
    newString += strings[i];

    return newString;

  },

  convert : function(match, nosign){
    if (nosign) {
      match.sign = '';
    } else {
      match.sign = match.negative ? '-' : match.sign;
    }
    var l = match.min - match.argument.length + 1 - match.sign.length;
    var pad = new Array(l < 0 ? 0 : l).join(match.pad);
    if (!match.left) {
      if (match.pad == '0' || nosign) {
        return match.sign + pad + match.argument;
      } else {
        return pad + match.sign + match.argument;
      }
    } else {
      if (match.pad == '0' || nosign) {
        return match.sign + match.argument + pad.replace(/0/g, ' ');
      } else {
        return match.sign + match.argument + pad;
      }
    }
  }
}

sprintf = sprintfWrapper.init;

//Normalization - Ensure component does not finish with component and capitalize first letter
Dashboards.normalizeAddInKey = function(key) {
  	if (key.indexOf('Component', key.length - 'Component'.length) !== -1) 
  		key = key.substring(0, key.length - 'Component'.length);	
	return key.charAt(0).toUpperCase() + key.substring(1);
}

Dashboards.registerAddIn = function(component,slot,addIn){
  if (!this.addIns) {
    this.addIns = {};
  }
  

  var key = this.normalizeAddInKey(component);
  
  
  if (!this.addIns[key]) {
    this.addIns[key] = {};  
  }
  if (!this.addIns[key][slot]) {
    this.addIns[key][slot] = {};  
  }
  this.addIns[key][slot][addIn.getName()] = addIn;  
};

Dashboards.hasAddIn = function(component,slot,addIn){
	var key = this.normalizeAddInKey(component);
  return Boolean(this.addIns && this.addIns[key] &&
    this.addIns[key][slot] && this.addIns[key][slot][addIn]);
};

Dashboards.getAddIn = function(component,slot,addIn){
	var key = this.normalizeAddInKey(component);
  try {
    return this.addIns[key][slot][addIn];
  } catch (e) {
    return null;
  }
};

Dashboards.setAddInDefaults = function(component, slot, addInName, defaults) {
var key = this.normalizeAddInKey(component);
  var addIn = this.getAddIn(key,slot,addInName);
  if(addIn) {
    addIn.setDefaults(defaults);
  }
};
Dashboards.listAddIns = function(component,slot) {
var key = this.normalizeAddInKey(component);
  var addInList = [];
  try {
    var slot = this.addIns[key][slot];
    for (var addIn in slot) if (slot.hasOwnProperty(addIn)) { 
      addInList.push([addIn, slot[addIn].getLabel()]);
    }
    return addInList;
  } catch (e) {
    return [];
  }
};

Dashboards.safeClone = function(){
  var options, name, src, copy, copyIsArray, clone,
  target = arguments[0] || {},
  i = 1,
  length = arguments.length,
  deep = false;

  // Handle a deep copy situation
  if ( typeof target === "boolean" ) {
    deep = target;
    target = arguments[1] || {};
    // skip the boolean and the target
    i = 2;
  }

  // Handle case when target is a string or something (possible in deep copy)
  if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
    target = {};
  }

  for ( ; i < length; i++ ) {
    // Only deal with non-null/undefined values
    if ( (options = arguments[ i ]) != null ) {
      // Extend the base object
      for ( name in options ) if (options.hasOwnProperty(name)) {
        src = target[ name ];
        copy = options[ name ];

        // Prevent never-ending loop
        if ( target === copy ) {
          continue;
        }

        // Recurse if we're merging plain objects or arrays
        if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
          if ( copyIsArray ) {
            copyIsArray = false;
            clone = src && jQuery.isArray(src) ? src : [];

          } else {
            clone = src && jQuery.isPlainObject(src) ? src : {};
          }

          // Never move original objects, clone them
          target[ name ] = this.safeClone( deep, clone, copy );

        // Don't bring in undefined values
        } else if ( copy !== undefined ) {
          target[ name ] = copy;
        }
      }
    }
  }

  // Return the modified object
  return target;
}

//Ctors:
// Query(queryString) --> DEPRECATED
// Query(queryDefinition{path, dataAccessId})
// Query(path, dataAccessId)
Query = function() {

  // Constants, or what passes for them... Pretty please leave these alone.
  var CDA_PATH = webAppPath + "/content/cda/doQuery?";
  var LEGACY_QUERY_PATH = webAppPath + "/ViewAction?solution=system&path=pentaho-cdf/actions&action=jtable.xaction";

  /*
   * Private fields
   */
  /* AJAX Options for the query */
  var _ajaxOptions = {
    type: "POST",
    async: false
  };
  // Datasource type definition
  var _mode = 'CDA';
  // CDA uses file+id, Legacy uses a raw query
  var _file = '';
  var _id = '';
  var _outputIdx = '1';
  var _query = '';
  // Callback for the data handler
  var _callback = null;
  // Result caching
  var _lastResultSet = null;
  // Paging and sorting
  var _page = 0;
  var _pageSize = 0;
  var _sortBy = "";
  // Exporting support
  var _exportIframe = null;
  var _params = [];
  /*
   * Initialization code
   */

  //
  (function(args){
    switch (args.length) {
      case 1:
        var cd = args[0];
        if (typeof cd.query != 'undefined') {
          // got a valid legacy cd object
          _mode = 'Legacy';
          _query = args[0];
        } else if (typeof cd.path != 'undefined' && typeof cd.dataAccessId != 'undefined'){
          // CDA-style cd object
          _mode = 'CDA';
          _file = cd.path;
          _id = cd.dataAccessId;
          if (typeof cd.sortBy == 'string' && cd.sortBy.match("^(?:[0-9]+[adAD]?,?)*$")) {
            _sortBy = cd.sortBy;
          }
          if(cd.pageSize != null){
            _pageSize = cd.pageSize;
          }
          if(cd.outputIndexId != null){
            _outputIdx = cd.outputIndexId;
          }		  
        } else {
          throw 'InvalidQuery';
        }
        break;
      case 2:
        _mode = 'CDA';
        var file = args[0];
        var id = args[1];
		if (typeof file != 'string' || typeof id != 'string') {
          throw 'InvalidQuery';
        } else {
          // Seems like we have valid parameters
          _id = id;
          _file = file;
        }
        break;
      default:
        throw "InvalidQuery";
    } 
  }(arguments));
  /*
   * Private methods
   */

  function doQuery(outsideCallback){
    if (typeof _callback != 'function') {
      throw 'QueryNotInitialized';
    }
    var url;
    var queryDefinition; 
    var callback = (outsideCallback ? outsideCallback : _callback);
    if (_mode == 'CDA') {
      url = CDA_PATH;
      queryDefinition = buildQueryDefinition();
    // Assemble parameters
    } else if (_mode == 'Legacy') {
      queryDefinition = _query;
      url = LEGACY_QUERY_PATH;
    }
    var successHandler = function(json) {
      if(_mode == 'Legacy'){
        json = eval("(" + json + ")");
      }
      _lastResultSet = json;
      var clone = Dashboards.safeClone(true,{},_lastResultSet);
      
      if (_mode == 'Legacy') {
        var newMetadata = [{
          "colIndex":0,
          "colType":"String",
          "colName":"Name"
        }];
        for (var i = 0 ; i < clone.metadata.length; i++) {
          var x = i;
          newMetadata.push({
            "colIndex":x+1,
            "colType":"String",
            "colName":clone.metadata[x]
          });
        }      
        clone.resultset = clone.values;
        clone.metadata = newMetadata;
        clone.values = null;
      }
      
      callback(clone);
    };

    var settings = _.extend({},_ajaxOptions, {
      success: function() {},
      data: queryDefinition,
      url: url,
      success: successHandler
    });
    
    $.ajax(settings);
  };

  function buildQueryDefinition(overrides) {
    overrides = overrides || {};
    var queryDefinition = {};
    
    var p = Dashboards.objectToPropertiesArray( Dashboards.safeClone({},Dashboards.propertiesArrayToObject(_params), overrides) )

    for (var param in p) {
      if(p.hasOwnProperty(param)) {
        var value; 
        var name = p[param][0];
        value = Dashboards.getParameterValue(p[param][1]);
        if($.isArray(value) && value.length == 1 && ('' + value[0]).indexOf(';') >= 0){
          //special case where single element will wrongly be treated as a parseable array by cda
          value = doCsvQuoting(value[0],';');
        }
        //else will not be correctly handled for functions that return arrays
        if (typeof value == 'function') value = value();
        queryDefinition['param' + name] = value;
      }
    }
    queryDefinition.path = _file;
    queryDefinition.dataAccessId = _id;
    queryDefinition.outputIndexId = _outputIdx;
    queryDefinition.pageSize = _pageSize;
    queryDefinition.pageStart = _page;
    queryDefinition.sortBy = _sortBy;
    return queryDefinition;
  };

  /*
   * Public interface
   */

  this.exportData = function(outputType, overrides, options) {
    if (_mode != 'CDA') {
      throw "UnsupportedOperation";
    }
    if (!options) {
      options = {};
    }
    var queryDefinition = buildQueryDefinition(overrides);
    queryDefinition.outputType = outputType;
    if (outputType == 'csv' && options.separator) {
      queryDefinition.settingcsvSeparator = options.separator;
    }
    if (options.filename) {
      queryDefinition.settingattachmentName= options.filename ;
    }
    if (outputType = 'xls' && options.template) {
      queryDefinition.settingtemplateName= options.template ;
    }
    if( options.columnHeaders ){
      queryDefinition.settingcolumnHeaders = options.columnHeaders;
    }

    if(options.dtFilter != null){
      queryDefinition.settingdtFilter = options.dtFilter;
      if(options.dtSearchableColumns != null){
        queryDefinition.settingdtSearchableColumns = options.dtSearchableColumns;
      }
    }
    
    var theDoQuery = CDA_PATH + 'wrapItUp=wrapit';
    var x = $.ajaxSettings.async;
    $.ajaxSetup({ async: false });
    $.post(theDoQuery, queryDefinition, function(uuid) {
      var _exportIframe = $('<iframe style="display:none">');
      _exportIframe.detach();
      _exportIframe[0].src = webAppPath + '/content/cda/unwrapQuery?' + $.param( {"path": queryDefinition.path, "uuid": uuid});
      _exportIframe.appendTo($('body'));
    });    
    $.ajaxSetup({ async: x});
    
    
  }

  this.setAjaxOptions = function(newOptions) {
    if(typeof newOptions == "object") {
      _.extend(_ajaxOptions,newOptions);
    }
  };

  this.fetchData = function(params, callback) {
    switch(arguments.length) {
      case 0:
        if(_params && _callback) {
          return doQuery();
        }
        break;
      case 1:
        if (typeof arguments[0] == "function"){
          /* If we're receiving _only_ the callback, we're not
           * going to change the internal callback
           */
          return doQuery(arguments[0]);
        } else if( arguments[0] instanceof Array){
          _params = arguments[0];
          return doQuery();
        }
        break;
      case 2:
      default:
        /* We're just going to discard anything over two params */
        _params = params;
        _callback = callback;
        return doQuery();
    }
    /* If we haven't hit a return by this time,
     * the user gave us some wrong input
     */
    throw "InvalidInput";
  };

  // Result caching
  this.lastResults = function(){
    if (_lastResultSet !== null) {
      return Dashboards.safeClone(true,{},_lastResultSet);
    } else {
      throw "NoCachedResults";
    }
  };

  this.reprocessLastResults = function(outerCallback){
    if (_lastResultSet !== null) {
      var clone = Dashboards.safeClone(true,{},_lastResultSet);
      var callback = outerCallback || _callback;
      return callback(clone);
    } else {
      throw "NoCachedResults";
    }
  };

  this.reprocessResults = function(outerCallback) {
    if (_lastResultSet !== null) {
      var clone = Dashboards.safeClone(true,{},_lastResultSet);
      var callback = (outsideCallback ? outsideCallback : _callback);
      callback(_mode == 'CDA' ? clone : clone.values);
    } else {
      throw "NoCachedResults";
    }
  };

  /* Sorting
   *
   * CDA expects an array of terms consisting of a number and a letter
   * that's either 'A' or 'D'. Each term denotes, in order, a column
   * number and sort direction: 0A would then be sorting the first column
   * ascending, and 1D would sort the second column in descending order.
   * This function accepts either an array with the search terms, or
   * a comma-separated string with the terms:  "0A,1D" would then mean
   * the same as the array ["0A","1D"], which would sort the results
   * first by the first column (ascending), and then by the second
   * column (descending).
   */
  this.setSortBy = function(sortBy) {
    var newSort;
    if (sortBy === null || sortBy === undefined || sortBy === '') {
      newSort = '';
    }
    /* If we have a string as input, we need to split it into
     * an array of sort terms. Also, independently of the parameter
     * type, we need to convert everything to upper case, since want
     * to accept 'a' and 'd' even though CDA demands capitals.
     */
    else if (typeof sortBy == "string") {
      /* Valid sortBy Strings are column numbers, optionally
       * succeeded by A or D (ascending or descending), and separated by commas
       */
      if (!sortBy.match("^(?:[0-9]+[adAD]?,?)*$")) {
        throw "InvalidSortExpression";
      }
      /* Break the string into its constituent terms, filter out empty terms, if any */
      newSort = sortBy.toUpperCase().split(',').filter(function(e){
        return e !== "";
      });
    } else if (sortBy instanceof Array) {
      newSort = sortBy.map(function(d){
        return d.toUpperCase();
      });
      /* We also need to validate that each individual term is valid */
      var invalidEntries = newSort.filter(function(e){
        return !e.match("^[0-9]+[adAD]?,?$")
      });
      if ( invalidEntries.length > 0) {
        throw "InvalidSortExpression";
      }
    }
      
    /* We check whether the parameter is the same as before,
     * and notify the caller on whether it changed
     */
    var same;
    if (newSort instanceof Array) {
      same = newSort.length != _sortBy.length;
      $.each(newSort,function(i,d){
        same = (same && d == _sortBy[i]);
        if(!same) {
          return false;
        }
      });
    } else {
      same = (newSort === _sortBy);
    }
    _sortBy = newSort;
    return !same;
  };

  this.sortBy = function(sortBy,outsideCallback) {
    /* If the parameter is not the same, and we have a valid state,
     * we can fire the query.
     */
    var changed = this.setSortBy(sortBy);
    if (!changed) {
      return false;
    } else if (_callback !== null) {
      return doQuery(outsideCallback);
    }
  };

  this.setParameters = function (params) {
    if((params instanceof Array)) {
      _params = params;
    } else {
      throw "InvalidParameters";
    }
  };

  this.setCallback = function(callback) {
    if(typeof callback == "function") {
      _callback = callback;
    } else {
      throw "InvalidCallback";
    }
  };
  /* Pagination
   *
   * We paginate by having an initial position (_page) and page size (_pageSize)
   * Paginating consists of incrementing/decrementing the initial position by
   * the page size. All paging operations change the paging cursor.
   */

  // Gets the next _pageSize results
  this.nextPage = function(outsideCallback) {
    if (_pageSize > 0) {
      _page += _pageSize;
      return doQuery(outsideCallback);
    } else {
      throw "InvalidPageSize";
    }
  };

  // Gets the previous _pageSize results
  this.prevPage = function(outsideCallback) {
    if (_page > _pageSize) {
      _page -= _pageSize;
      return doQuery(outsideCallback);
    } else if (_pageSize > 0) {
      _page = 0;
      return doQuery(outsideCallback);
    } else {
      throw "AtBeggining";
    }
  };

  // Gets the page-th set of _pageSize results (0-indexed)
  this.getPage = function(page, outsideCallback) {
    if (page * _pageSize == _page) {
      return false;
    } else if (typeof page == 'number' && page >= 0) {
      _page = page * _pageSize;
      return doQuery(outsideCallback);
    } else {
      throw "InvalidPage";
    }
  };

  // Gets _pageSize results starting at page
  this.setPageStartingAt = function(page) {
    if (page == _page) {
      return false;
    } else if (typeof page == 'number' && page >= 0) {
      _page = page;
    } else {
      throw "InvalidPage";
    }
  };

  this.pageStartingAt = function(page,outsideCallback) {
    if(this.setPageStartingAt(page) !== false) {
      return doQuery(outsideCallback);
    } else {
      return false;
    }
  };

  // Sets the page size
  this.setPageSize = function(pageSize) {
    if (typeof pageSize == 'number' && pageSize > 0) {
      _pageSize = pageSize;
    } else {
      throw "InvalidPageSize";
    }
  };

  // sets _pageSize to pageSize, and gets the first page of results
  this.initPage = function(pageSize,outsideCallback) {
    if (pageSize == _pageSize && _page == 0) {
      return false;
    } else if (typeof pageSize == 'number' && pageSize > 0) {
      _page = 0;
      _pageSize = pageSize;
      return doQuery(outsideCallback);
    } else {
      throw "InvalidPageSize";
    }
  };
};

/*
 * UTILITY STUFF
 *
 * 
 */

(function() {
  function accessorDescriptor(field, fun)
  {
    var desc = {
      enumerable: true, 
      configurable: true
    };
    desc[field] = fun;
    return desc;
  }
  
  this.defineGetter = function defineGetter(obj, prop, get)
  {
    if (Object.prototype.__defineGetter__)
      return obj.__defineGetter__(prop, get);
    if (Object.defineProperty)
      return Object.defineProperty(obj, prop, accessorDescriptor("get", get));
  
    throw new Error("browser does not support getters");
  }
  
  this.defineSetter = function defineSetter(obj, prop, set)
  {
    if (Object.prototype.__defineSetter__)
      return obj.__defineSetter__(prop, set);
    if (Object.defineProperty)
      return Object.defineProperty(obj, prop, accessorDescriptor("set", set));
  
    throw new Error("browser does not support setters");
  }
})();
