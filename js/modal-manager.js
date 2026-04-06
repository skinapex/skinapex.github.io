/* ============================================================
   SkinApex - ModalManager
   Unified modal dialogs for alert/confirm/prompt.
   ============================================================ */

(function () {
    'use strict';

    const Utils = SkinApex.Utils;

    class ModalManager {
        constructor() {}

        _open(title, bodyHtml, buttons) {
            return new Promise((resolve) => {
                var overlay = document.createElement('div');
                overlay.className = 'crypt-overlay';

                var dialog = document.createElement('div');
                dialog.className = 'crypt-dialog';

                var header = document.createElement('div');
                header.className = 'crypt-dialog-header';
                header.innerHTML =
                    '<span class="crypt-dialog-title">' + Utils.escapeHtml(title || 'Dialog') + '</span>' +
                    '<button class="crypt-dialog-close" type="button">&times;</button>';

                var body = document.createElement('div');
                body.className = 'crypt-dialog-body';
                body.innerHTML = bodyHtml || '';

                var footer = document.createElement('div');
                footer.className = 'crypt-dialog-footer';

                for (var i = 0; i < buttons.length; i++) {
                    (function (btnCfg) {
                        var btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'crypt-btn' + (btnCfg.primary ? ' crypt-btn-primary' : '');
                        btn.textContent = btnCfg.label;
                        btn.addEventListener('click', function () {
                            var value = btnCfg.getValue ? btnCfg.getValue(body) : btnCfg.value;
                            close(value);
                        });
                        footer.appendChild(btn);
                    })(buttons[i]);
                }

                dialog.appendChild(header);
                dialog.appendChild(body);
                dialog.appendChild(footer);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                function close(value) {
                    overlay.remove();
                    resolve(value);
                }

                header.querySelector('.crypt-dialog-close').addEventListener('click', function () {
                    close(null);
                });
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) close(null);
                });

                var input = body.querySelector('input, textarea');
                if (input) {
                    setTimeout(function () {
                        input.focus();
                        if (input.select) input.select();
                    }, 0);
                }
            });
        }

        custom(title, bodyHtml, footerHtml) {
            var overlay = document.createElement('div');
            overlay.className = 'crypt-overlay';

            var dialog = document.createElement('div');
            dialog.className = 'crypt-dialog';

            var header = document.createElement('div');
            header.className = 'crypt-dialog-header';
            header.innerHTML =
                '<span class="crypt-dialog-title">' + Utils.escapeHtml(title || 'Dialog') + '</span>' +
                '<button class="crypt-dialog-close" type="button">&times;</button>';

            var body = document.createElement('div');
            body.className = 'crypt-dialog-body';
            body.innerHTML = bodyHtml || '';

            var footer = document.createElement('div');
            footer.className = 'crypt-dialog-footer';
            if (footerHtml) footer.innerHTML = footerHtml;

            dialog.appendChild(header);
            dialog.appendChild(body);
            dialog.appendChild(footer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            var closeFn = function () {
                overlay.remove();
            };

            header.querySelector('.crypt-dialog-close').addEventListener('click', closeFn);
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeFn();
            });

            return { overlay: overlay, dialog: dialog, body: body, footer: footer, close: closeFn };
        }

        alert(title, message) {
            return this._open(title || 'Alert', '<div class="crypt-field"><div>' + Utils.escapeHtml(message || '') + '</div></div>', [
                { label: 'OK', primary: true, value: true }
            ]);
        }

        confirm(title, message) {
            return this._open(title || 'Confirm', '<div class="crypt-field"><div>' + Utils.escapeHtml(message || '') + '</div></div>', [
                { label: 'Cancel', value: false },
                { label: 'OK', primary: true, value: true }
            ]).then(function (v) { return !!v; });
        }

        prompt(title, message, defaultValue) {
            var body =
                '<div class="crypt-field">' +
                    '<label>' + Utils.escapeHtml(message || '') + '</label>' +
                    '<input type="text" id="modal-prompt-input" value="' + Utils.escapeHtml(defaultValue || '') + '">' +
                '</div>';

            return this._open(title || 'Input', body, [
                { label: 'Cancel', value: null },
                {
                    label: 'OK',
                    primary: true,
                    getValue: function (bodyEl) {
                        var input = bodyEl.querySelector('#modal-prompt-input');
                        return input ? input.value : '';
                    }
                }
            ]);
        }
    }

    window.SkinApex.ModalManager = ModalManager;
})();
