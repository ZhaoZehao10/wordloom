package com.wordloom.roam;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;

/**
 * 拾径 Wordloom — Pico Neo3 离线 APK 壳。
 *
 * 原理：APK 内置微型 HTTP 服务器，把游戏资产拷到应用私有目录后伺服在
 * http://127.0.0.1:8899/ 上，然后拉起默认浏览器（头显上即 Pico 浏览器）访问。
 *
 * 为什么必须走 127.0.0.1 的 HTTP 而不是 file://：
 * WebXR 要求 secure context。W3C 规范把 127.0.0.1 列为「潜在可信来源」，
 * Chromium 系浏览器（含 Pico 浏览器）对 loopback 明文 HTTP 暴露 navigator.xr，
 * 这是 WebXR 开发调试的标准做法；file:// 在桌面 Chrome 可行，但头显浏览器
 * 的文件访问入口不可控，APK 内嵌服务是确定性最高的路径。
 */
public class MainActivity extends Activity {

    static final int PORT = 8899;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        TextView tv = new TextView(this);
        tv.setText("🎲 拾径 Wordloom\n\n本地服务启动中…\n浏览器将自动打开 http://127.0.0.1:" + PORT + "/\n\n若未自动打开：手动打开「浏览器」输入上面地址。\n此页面可留在后台（服务随本应用运行）。");
        tv.setGravity(Gravity.CENTER);
        tv.setTextSize(18);
        tv.setLineSpacing(4, 1.2f);
        setContentView(tv);

        try {
            copyAssetsToFiles();
        } catch (IOException e) {
            tv.setText("资产解压失败：" + e);
            return;
        }

        new Thread(new ServerRunnable(getFilesDir())).start();
        sleep(400); // 给 ServerSocket 一点就绪时间
        openBrowser();
    }

    static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    void copyAssetsToFiles() throws IOException {
        File dir = getFilesDir();
        // assets/game/ 下只有一个自包含 index.html（构建时已把 three/VRButton/游戏模块全部内联）
        String[] files = listAssets("game");
        for (String name : files) {
            InputStream in = getAssets().open("game/" + name);
            File out = new File(dir, "game-" + name);
            OutputStream os = new FileOutputStream(out);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            os.close();
            in.close();
        }
    }

    String[] listAssets(String path) throws IOException {
        return getAssets().list(path);
    }

    void openBrowser() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:" + PORT + "/rw/index.html"));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
        } catch (Exception e) {
            // 没有可处理 http 的应用（理论上头显必有浏览器）：停留在提示页
        }
    }

    /** 极简 HTTP/1.0 静态服务器：只处理 GET，Connection: close，仅绑定 loopback。 */
    static class ServerRunnable implements Runnable {
        final File filesDir;

        ServerRunnable(File filesDir) { this.filesDir = filesDir; }

        @Override
        public void run() {
            try {
                ServerSocket ss = new ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"));
                while (true) {
                    final Socket s = ss.accept();
                    new Thread(new Runnable() {
                        @Override
                        public void run() { handle(s); }
                    }).start();
                }
            } catch (IOException e) {
                // 端口被占（重复启动）：直接退出线程，浏览器已能连上先前的实例
            }
        }

        void handle(Socket s) {
            try {
                s.setSoTimeout(4000);
                byte[] req = new byte[2048];
                int got = s.getInputStream().read(req);
                if (got <= 0) { s.close(); return; }
                String line = new String(req, 0, got, Charset.forName("UTF-8"));
                // "GET /path HTTP/1.1"
                String path = "/";
                String[] parts = line.split(" ");
                if (parts.length >= 2) path = parts[1];
                if (path.contains("..")) { respond(s, 403, "text/plain", "forbidden"); return; }
                if (path.equals("/") || path.equals("/index.html")) path = "/rw/index.html";

                if (path.equals("/rw/index.html")) {
                    File f = new File(filesDir, "game-index.html");
                    if (!f.exists()) { respond(s, 404, "text/plain", "game not extracted"); return; }
                    byte[] body = readAll(f);
                    // APK 场景替换离线版的底部提示
                    String html = new String(body, Charset.forName("UTF-8"))
                        .replace("单文件离线版 · 若无 ENTER VR 按钮请改用 APK 版（README）",
                                 "APK 版 · 全部资源内置 · 无需网络");
                    respond(s, 200, "text/html; charset=utf-8", html.getBytes(Charset.forName("UTF-8")));
                    return;
                }
                respond(s, 404, "text/plain", "not found");
            } catch (Exception e) {
                try { s.close(); } catch (IOException ignored) {}
            }
        }

        byte[] readAll(File f) throws IOException {
            InputStream in = new java.io.FileInputStream(f);
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return bo.toByteArray();
        }

        void respond(Socket s, int code, String type, byte[] body) throws IOException {
            String head = "HTTP/1.0 " + code + " OK\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n";
            s.getOutputStream().write(head.getBytes(Charset.forName("UTF-8")));
            s.getOutputStream().write(body);
            s.getOutputStream().flush();
            s.close();
        }

        void respond(Socket s, int code, String type, String text) throws IOException {
            respond(s, code, type, text.getBytes(Charset.forName("UTF-8")));
        }
    }
}
