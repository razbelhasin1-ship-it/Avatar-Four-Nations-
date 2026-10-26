package io.github.razbelhasin1.avatarfournations;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts the browser game full-screen. The web build is bundled in the APK's
 * assets (assets/game/) and served over a virtual https origin, so ES modules,
 * the map worker and localStorage saves behave exactly as on the web.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://appassets.androidplatform.net/assets/game/index.html";

    private WebView web;
    private long lastBack;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse res = loader.shouldInterceptRequest(request.getUrl());
                if (res == null) return null;
                // Module scripts are only executed with a JavaScript MIME type: never rely on guessing.
                String type = mimeFor(request.getUrl().getPath());
                return type == null ? res : new WebResourceResponse(type, "utf-8", res.getData());
            }
        });
        setContentView(web);
        hideSystemBars();

        if (state != null) web.restoreState(state);
        else web.loadUrl(START_URL);
    }

    private static String mimeFor(String path) {
        if (path == null) return null;
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".mp3")) return "audio/mpeg";
        return null;
    }

    /** Back opens the game's pause menu (Escape); pressing it twice quickly leaves the app. */
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 1800) {
            super.onBackPressed();
            return;
        }
        lastBack = now;
        web.evaluateJavascript(
                "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape'}));"
                        + "setTimeout(function(){window.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape',key:'Escape'}));},60);",
                null);
        Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
