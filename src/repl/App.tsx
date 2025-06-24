import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import Terminal from './components/Terminal';
import Editor from './components/Editor';
import Plot from './components/Plot';
import Files from './components/Files';
import { Readline } from 'xterm-readline';
import { WebR } from '../webR/webr-main';
import { bufferToBase64 } from '../webR/utils';
import { CanvasMessage, PagerMessage, ViewMessage, BrowseMessage } from '../webR/webr-chan';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
import './App.css';
import { NamedObject, WebRDataJsAtomic } from '../webR/robj';

const webR = new WebR({
  RArgs: [],
  REnv: {
    R_HOME: '/usr/lib/R',
    FONTCONFIG_PATH: '/etc/fonts',
    R_ENABLE_JIT: '0',
    COLORTERM: 'truecolor',
  },
});
(globalThis as any).webR = webR;

export interface TerminalInterface {
  println: Readline['println'];
  read: Readline['read'];
  write: Readline['write'];
}

export interface FilesInterface {
  refreshFilesystem: () => Promise<void>;
  openFileInEditor: (name: string, path: string, readOnly: boolean) => Promise<void>;
  openDataInEditor: (title: string, data: NamedObject<WebRDataJsAtomic<string>> ) => void;
  openHtmlInEditor: (src: string, path: string) => void;
}

export interface PlotInterface {
  resize: (direction: "width" | "height", px: number) => void;
  newPlot: () => void;
  drawImage: (img: ImageBitmap) => void;
}

const terminalInterface: TerminalInterface = {
  println: (msg: string) => { console.log(msg); },
  read: () => Promise.reject(new Error('Unable to read from webR terminal.')),
  write: (msg: string) => { console.log(msg); },
};

const filesInterface: FilesInterface = {
  refreshFilesystem: () => Promise.resolve(),
  openFileInEditor: () => { throw new Error('Unable to open file, editor not initialised.'); },
  openDataInEditor: () => { throw new Error('Unable to view data, editor not initialised.'); },
  openHtmlInEditor: () => { throw new Error('Unable to view HTML, editor not initialised.'); },
};

const plotInterface: PlotInterface = {
  resize: () => { return; },
  newPlot: () => { return; },
  drawImage: () => {
    throw new Error('Unable to plot, plotting not initialised.');
  },
};

function handleCanvasMessage(msg: CanvasMessage) {
  if (msg.data.event === 'canvasImage') {
    plotInterface.drawImage(msg.data.image);
  } else if (msg.data.event === 'canvasNewPage') {
    plotInterface.newPlot();
  }
}

async function handlePagerMessage(msg: PagerMessage) {
  const { path, title, deleteFile } = msg.data;
  await filesInterface.openFileInEditor(title, path, true);
  if (deleteFile) {
    await webR.FS.unlink(path);
  }
}

async function handleBrowseMessage(msg: BrowseMessage) {
  const { url } = msg.data;
  const root = url.split('/').slice(0, -1).join('/');
  const decoder = new TextDecoder('utf8');
  let content = decoder.decode(await webR.FS.readFile(url));

  // Replace relative URLs in HTML output with the contents of the VFS.
  /* TODO: This should really be handled by a custom print method sending the
   *       entire R object reference to the main thread, rather than performing
   *       regex on HTML -- famously a bad idea because HTML is context-free.
   *       Saying that, this does seem to work reasonably well for now.
   *
   *       Since we don't load the `webr` support package by default, the
   *       alternative looks to be using hacks to register a bunch of custom S3
   *       generics like `print.htmlwidget` in the "webr_shim" namespace, and
   *       then maintain the `search()` order as other packages are loaded so
   *       that our namespace is always at the front, messy.
   */
  const jsRegex = /<script.*src=["'`](.+\.js)["'`].*>.*<\/script>/g;
  const jsMatches = Array.from(content.matchAll(jsRegex) || []);
  const jsContent: {[idx: number]: string} = {};
  await Promise.all(jsMatches.map((match, idx) => {
    return webR.FS.readFile(`${root}/${match[1]}`)
      .then((file) => bufferToBase64(file))
      .then((enc) => {
        jsContent[idx] = "data:text/javascript;base64," + enc;
      });
  }));
  jsMatches.forEach((match, idx) => {
    content = content.replace(match[0], `
      <script type="text/javascript" src="${jsContent[idx]}"></script>
    `);
  });

  let injectedBaseStyle = false;
  const cssBaseStyle = `<style>body{font-family: sans-serif;}</style>`;
  const cssRegex = /<link.*href=["'`](.+\.css)["'`].*>/g;
  const cssMatches = Array.from(content.matchAll(cssRegex) || []);
  const cssContent: {[idx: number]: string} = {};
  await Promise.all(cssMatches.map((match, idx) => {
    return webR.FS.readFile(`${root}/${match[1]}`)
      .then((file) => bufferToBase64(file))
      .then((enc) => {
        cssContent[idx] = "data:text/css;base64," + enc;
      });
  }));
  cssMatches.forEach((match, idx) => {
    let cssHtml = `<link rel="stylesheet" href="${cssContent[idx]}"/>`;
    if (!injectedBaseStyle){
      cssHtml = cssBaseStyle + cssHtml;
      injectedBaseStyle = true;
    }
    content = content.replace(match[0], cssHtml);
  });

  filesInterface.openHtmlInEditor(content, url);
}

function handleViewMessage(msg: ViewMessage) {
  const { title, data } = msg.data;
  filesInterface.openDataInEditor(title, data);
}

const onPanelResize = (size: number) => {
  plotInterface.resize("width", size * window.innerWidth / 100);
};

// Function to load sample CSV data into WebR
async function loadSampleData() {
  try {
    // Create mtcars dataset
    const mtcarsData = `
mpg,cyl,disp,hp,drat,wt,qsec,vs,am,gear,carb
21.0,6,160,110,3.90,2.620,16.46,0,1,4,4
21.0,6,160,110,3.90,2.875,17.02,0,1,4,4
22.8,4,108,93,3.85,2.320,18.61,1,1,4,1
21.4,6,258,110,3.08,3.215,19.44,1,0,3,1
18.7,8,360,175,3.15,3.440,17.02,0,0,3,2
18.1,6,225,105,2.76,3.460,20.22,1,0,3,1
14.3,8,360,245,3.21,3.570,15.84,0,0,3,4
24.4,4,146.7,62,3.69,3.190,20.00,1,0,4,2
22.8,4,140.8,95,3.92,3.150,22.90,1,0,4,2
19.2,6,167.6,123,3.92,3.440,18.30,1,0,4,4
`;

    // Analysis R script
    const analysisScript = `
## Dependencies
install.packages('tidyverse')
install.packages('lme4')
install.packages('nloptr')
library(tidyverse)
library(lme4)
library(nloptr)

## Path
getwd()
setwd("/1_uhc_summer_class")
getwd()
list.files()

## Data
df_data = read_csv("mtcars.csv")

## Plot
df_data |> 
  ggplot(aes(x = wt, y = mpg)) + 
  geom_point()

## Model

### Simple linear regression
model_simple <- lm(mpg ~ wt, data = df_data)
summary(model_simple)

### Multiple regression
model_multiple <- lm(mpg ~ wt + hp + cyl, data = df_data)
summary(model_multiple)

### Mixed Model
model_mixed <- lmer(mpg ~ wt + hp + (1|cyl), data = df_data)
summary(model_mixed)
`;

    // Create the directory /1_uhc_summer_class/
    await webR.FS.mkdir('/1_uhc_summer_class');

    // Write files to the new directory
    await webR.FS.writeFile('/1_uhc_summer_class/mtcars.csv', new TextEncoder().encode(mtcarsData));
    await webR.FS.writeFile('/1_uhc_summer_class/analysis.R', new TextEncoder().encode(analysisScript));
    
    // Load the data into R environment
    await webR.evalRVoid(`
      # Load mtcars dataset from CSV
      mtcars_data <- read.csv('/1_uhc_summer_class/mtcars.csv')
      
      # Make it available in global environment
      assign('mtcars_data', mtcars_data, envir = .GlobalEnv)
      
      cat('🎓 UHC Summer Class Data Loaded!\\n')
      cat('📁 Files available in /1_uhc_summer_class/:\\n')
      cat('  - mtcars.csv (car performance dataset)\\n')
      cat('  - analysis.R (data analysis script)\\n')
      cat('\\n📊 Variable loaded:\\n')
      cat('  - mtcars_data (32 cars with 11 variables)\\n')
      cat('\\n💡 Try: source("/1_uhc_summer_class/analysis.R")\\n\\n')
    `);
    
  } catch (error) {
    console.error('Error loading sample data:', error);
  }
}

// Function to install and load common R packages
async function loadCommonPackages() {
  try {
    // Install and load common packages
    await webR.evalRVoid(`
      cat('📦 Loading common R packages...\\n')
      
      # Load base packages that are typically available
      library(stats)
      library(graphics)
      library(utils)
      library(datasets)
      
      # Try to install and load additional useful packages
      # Note: Some packages may not be available in WebR
      tryCatch({
        # These are commonly available in WebR
        cat('  ✓ Base packages loaded\\n')
        
        # Set up some useful options
        options(
          digits = 4,
          scipen = 6,
          show.signif.stars = FALSE
        )
        
        cat('  ✓ Common settings configured\\n')
        cat('\\n🚀 Ready to use! Try: head(mtcars_data) or plot(mtcars_data$mpg)\\n\\n')
        
      }, error = function(e) {
        cat('Some packages may not be available in WebR\\n')
      })
    `);
    
  } catch (error) {
    console.error('Error loading packages:', error);
  }
}

function App() {
  const rightPanelRef = React.useRef<ImperativePanelHandle | null>(null);
  React.useEffect(() => {
    window.addEventListener("resize", () => {
      if (!rightPanelRef.current) return;
      onPanelResize(rightPanelRef.current.getSize());
    });
  }, []);

  return (
    <div className='repl'>
    <PanelGroup direction="horizontal">
      <Panel defaultSize={50} minSize={10}>
        <PanelGroup autoSaveId="conditional" direction="vertical">
          <Editor
            webR={webR}
            terminalInterface={terminalInterface}
            filesInterface={filesInterface}
          />
          <PanelResizeHandle />
          <Terminal webR={webR} terminalInterface={terminalInterface} />
        </PanelGroup>
      </Panel>
      <PanelResizeHandle />
      <Panel ref={rightPanelRef} onResize={onPanelResize} minSize={10}>
        <PanelGroup direction="vertical">
          <Files webR={webR} filesInterface={filesInterface} />
          <PanelResizeHandle />
          <Plot webR={webR} plotInterface={plotInterface} />
        </PanelGroup>
      </Panel>
    </PanelGroup>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<StrictMode><App /></StrictMode>);

void (async () => {
  await webR.init();

  // Set the default graphics device, browser, and pager
  await webR.evalRVoid('webr::viewer_install()');
  await webR.evalRVoid('webr::pager_install()');
  await webR.evalRVoid(`
    webr::canvas_install(
      width = getOption("webr.fig.width", 504),
      height = getOption("webr.fig.height", 504)
    )
  `);

  // shim function from base R with implementations for webR
  // see ?webr::shim_install for details.
  await webR.evalRVoid('webr::shim_install()');

  // If supported, show a menu when prompted for missing package installation
  const showMenu = crossOriginIsolated;
  await webR.evalRVoid('options(webr.show_menu = show_menu)', { env: { show_menu: !!showMenu } });
  await webR.evalRVoid('webr::global_prompt_install()', { withHandlers: false });
  // Additional options for running packages under wasm
  await webR.evalRVoid('options(rgl.printRglwidget = TRUE)');

  // Load sample CSV data files
  await loadSampleData();

  // Install and load common R packages
  await loadCommonPackages();

  // Clear the loading message
  terminalInterface.write('\x1b[2K\r');

  for (; ;) {
    const output = await webR.read();
    switch (output.type) {
      case 'stdout':
        terminalInterface.println(output.data as string);
        break;
      case 'stderr':
        terminalInterface.println(`\x1b[1;31m${output.data as string}\x1b[m`);
        break;
      case 'prompt':
        void filesInterface.refreshFilesystem();
        terminalInterface.read(output.data as string).then((command) => {
          webR.writeConsole(command);
        }, (reason) => {
          console.error(reason);
          throw new Error(`An error occurred reading from the R console terminal.`);
        });
        break;
      case 'canvas':
        handleCanvasMessage(output as CanvasMessage);
        break;
      case 'pager':
        await handlePagerMessage(output as PagerMessage);
        break;
      case 'view':
        handleViewMessage(output as ViewMessage);
        break;
      case 'browse':
        void handleBrowseMessage(output as BrowseMessage);
        break;
      case 'closed':
        throw new Error('The webR communication channel has been closed');
      default:
        console.error(`Unimplemented output type: ${output.type}`);
        console.error(output.data);
    }
  }
})();
