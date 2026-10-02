import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Window
import HypeSettings

QQC2.Popup {
    id: popup
    parent: QQC2.Overlay.overlay
    anchors.centerIn: parent
    modal: true
    padding: 28
    background: Rectangle { radius: 24; color: Theme.popup }
    enter: Transition { NumberAnimation { property: "scale"; from: 0.6; to: 1; duration: 320; easing.type: Easing.OutBack } }

    Column {
        spacing: 16
        SymbolIcon {
            anchors.horizontalCenter: parent.horizontalCenter
            source: "starred-symbolic"
            tint: Theme.accent
            width: 56; height: 56
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: qsTr("Congratulations! You found the easter egg!")
            color: Theme.text
            font.pixelSize: 18
            font.weight: Font.Medium
        }
        ChromeButton {
            anchors.horizontalCenter: parent.horizontalCenter
            text: qsTr("Start game")
            filled: true
            onClicked: {
                popup.close()
                game.show()
                game.requestActivate()
                game.restart()
            }
        }
    }

    AsteroidsGame { id: game }
}
