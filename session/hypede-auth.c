/*
 * hypede-auth — проверка пароля для экрана блокировки HypeDE.
 *
 * GNOME Shell проверяет пароль через GDM. С другим экраном входа (SDDM,
 * greetd, LightDM) GDM нет, и экран блокировки GNOME не работает вовсе.
 * Тогда оболочка HypeDE запускает эту программу и ведёт через неё обычный
 * PAM-диалог (служба «hypede», /etc/pam.d/hypede) — так же, как swaylock
 * или экран блокировки KDE.
 *
 * Протокол — строки через stdin/stdout:
 *   вывод:  SECRET <вопрос>   ждём ответ, не показывая его (пароль)
 *           QUERY <вопрос>    ждём ответ, показывая его
 *           INFO <текст>      сообщение (например, «Приложите палец»)
 *           ERROR <текст>     ошибка от модуля PAM
 *           OK                пароль верный
 *           FAIL <текст>      пароль неверный или PAM отказал
 *   ввод:   одна строка — ответ на последний вопрос.
 *
 * Проверяется только пользователь, запустивший программу.
 */

#define _GNU_SOURCE
#include <pwd.h>
#include <security/pam_appl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void
print_line (const char *kind, const char *text)
{
    printf ("%s", kind);
    if (text) {
        putchar (' ');
        /* Перевод строки сломал бы протокол — заменяем пробелом. */
        for (const char *c = text; *c; c++)
            putchar (*c == '\n' || *c == '\r' ? ' ' : *c);
    }
    putchar ('\n');
    fflush (stdout);
}

static char *
read_answer (void)
{
    char *line = NULL;
    size_t size = 0;
    ssize_t len = getline (&line, &size, stdin);

    if (len < 0) {
        free (line);
        return NULL;
    }
    if (len > 0 && line[len - 1] == '\n')
        line[len - 1] = '\0';
    return line;
}

static int
conversation (int count, const struct pam_message **messages,
              struct pam_response **responses, void *data)
{
    (void) data;
    struct pam_response *replies = calloc (count, sizeof *replies);

    if (!replies)
        return PAM_BUF_ERR;

    for (int i = 0; i < count; i++) {
        const struct pam_message *msg = messages[i];

        switch (msg->msg_style) {
        case PAM_PROMPT_ECHO_OFF:
        case PAM_PROMPT_ECHO_ON:
            print_line (msg->msg_style == PAM_PROMPT_ECHO_OFF ? "SECRET" : "QUERY",
                        msg->msg);
            replies[i].resp = read_answer ();
            if (!replies[i].resp)
                goto fail;
            break;
        case PAM_ERROR_MSG:
            print_line ("ERROR", msg->msg);
            break;
        case PAM_TEXT_INFO:
            print_line ("INFO", msg->msg);
            break;
        default:
            goto fail;
        }
    }
    *responses = replies;
    return PAM_SUCCESS;

fail:
    for (int i = 0; i < count; i++) {
        if (replies[i].resp) {
            explicit_bzero (replies[i].resp, strlen (replies[i].resp));
            free (replies[i].resp);
        }
    }
    free (replies);
    return PAM_CONV_ERR;
}

int
main (void)
{
    struct passwd *pw = getpwuid (getuid ());
    if (!pw) {
        print_line ("FAIL", "unknown user");
        return 2;
    }

    struct pam_conv conv = { conversation, NULL };
    pam_handle_t *pamh = NULL;
    int status = pam_start ("hypede", pw->pw_name, &conv, &pamh);

    if (status == PAM_SUCCESS)
        status = pam_authenticate (pamh, 0);
    if (status == PAM_SUCCESS) {
        /* Обновить учётные данные (Kerberos и т.п.), как делает GDM при
         * разблокировке. Ошибка здесь не мешает войти. */
        pam_setcred (pamh, PAM_REFRESH_CRED);
        print_line ("OK", NULL);
    } else {
        print_line ("FAIL", pam_strerror (pamh, status));
    }

    if (pamh)
        pam_end (pamh, status);
    return status == PAM_SUCCESS ? 0 : 1;
}
